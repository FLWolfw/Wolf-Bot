import { PermissionsBitField } from 'discord.js';
import { getGuildConfig } from '../services/guildConfigService.js';
import { createSecurityIncident, persistSecurityLog } from '../services/securityLogService.js';
import { logger } from '../utils/logger.js';

const trackers = new Map();
const incidents = new Map();

const DEFAULT_THRESHOLDS = {
  channelDelete: 3,
  channelCreate: 5,
  channelUpdate: 5,
  roleCreate: 3,
  roleDelete: 3,
  roleUpdate: 3,
  ban: 3,
  kick: 3,
  webhook: 2,
};

const DEFAULT_WINDOW_MS = 10000;
const DEFAULT_INCIDENT_WINDOW_MS = 30000;

function key(guildId, executorId, type) {
  return `${guildId}:${executorId}:${type}`;
}

function normalizeConfig(config) {
  const anti = config?.antiNuke || {};
  return {
    enabled: anti.enabled !== false,
    windowMs: Math.min(60000, Math.max(1000, Number(anti.windowMs) || DEFAULT_WINDOW_MS)),
    incidentWindowMs: Math.min(120000, Math.max(5000, Number(anti.incidentWindowMs) || DEFAULT_INCIDENT_WINDOW_MS)),
    action: ['alert', 'quarantine', 'ban'].includes(anti.action) ? anti.action : 'quarantine',
    thresholds: { ...DEFAULT_THRESHOLDS, ...(anti.thresholds || {}) },
    protections: anti.protections || {},
    safeRoleIds: Array.isArray(anti.safeRoleIds) ? anti.safeRoleIds : [],
    protectedRoleIds: Array.isArray(anti.protectedRoleIds) ? anti.protectedRoleIds : [],
    protectedUserIds: Array.isArray(anti.protectedUserIds) ? anti.protectedUserIds : [],
  };
}

function getActions(guildId, executorId, type, now, windowMs) {
  const k = key(guildId, executorId, type);
  const actions = (trackers.get(k) || []).filter((t) => now - t < windowMs);
  trackers.set(k, actions);
  return actions;
}

function hasProtectedPermission(member) {
  return member.permissions?.has(PermissionsBitField.Flags.Administrator)
    || member.permissions?.has(PermissionsBitField.Flags.ManageGuild)
    || member.permissions?.has(PermissionsBitField.Flags.ManageChannels)
    || member.permissions?.has(PermissionsBitField.Flags.ManageRoles)
    || member.permissions?.has(PermissionsBitField.Flags.BanMembers);
}

async function takeAction(member, action, reason) {
  if (action === 'alert') return 'alert_only';

  try {
    if (action === 'ban' && member.bannable) {
      await member.ban({ reason });
      return 'ban';
    }

    if (action === 'quarantine' && member.manageable) {
      await member.roles.set([], reason).catch(() => {});
      if (member.moderatable) await member.timeout(60 * 60 * 1000, reason).catch(() => {});
      return 'quarantine';
    }
  } catch (error) {
    logger.error('Anti-nuke action failed', { action, error: error?.message });
  }

  return 'alert_only';
}

async function openIncident({ db, guild, executor, type, member, actionCount, config }) {
  const incidentKey = `${guild.id}:${executor.id}`;
  const existing = incidents.get(incidentKey);
  if (existing && Date.now() - existing.createdAt < config.incidentWindowMs) return existing;

  const incidentId = `INC-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.random().toString(16).slice(2, 10).toUpperCase()}`;
  const reason = `Wolf Anti-Nuke: ${type} threshold exceeded (${actionCount}/${config.thresholds[type]})`;
  const actionTaken = await takeAction(member, config.action, reason);
  const incident = { incidentId, createdAt: Date.now(), actionTaken };
  incidents.set(incidentKey, incident);

  await createSecurityIncident(db, {
    incidentId,
    guildId: guild.id,
    executorId: executor.id,
    executorTag: executor.tag || executor.username || executor.id,
    severity: 'critical',
    triggerType: type,
    actionTaken,
    metadata: {
      actionCount,
      limit: config.thresholds[type] || null,
      windowMs: config.windowMs,
      configuredAction: config.action,
      memberManageable: Boolean(member.manageable),
      memberModeratable: Boolean(member.moderatable),
      memberBannable: Boolean(member.bannable),
    },
  });

  await persistSecurityLog(db, {
    guildId: guild.id,
    incidentId,
    eventType: `anti_nuke.${type}`,
    severity: 'critical',
    executorId: executor.id,
    executorTag: executor.tag || executor.username || executor.id,
    targetId: executor.id,
    targetType: 'user',
    reason,
    metadata: {
      actionCount,
      limit: config.thresholds[type] || null,
      windowMs: config.windowMs,
      configuredAction: config.action,
      actionTaken,
      hierarchyBlocked: actionTaken === 'alert_only' && config.action !== 'alert',
    },
  });

  logger.warn('🚨 Anti-Nuke incident', {
    guildId: guild.id,
    executorId: executor.id,
    type,
    actionCount,
    actionTaken,
    incidentId,
  });
  return incident;
}

async function handleAction(type, guild, executor, client) {
  if (!guild || !executor || executor.bot || executor.id === guild.ownerId) return null;

  const config = normalizeConfig(await getGuildConfig(client.db, guild.id));
  if (!config.enabled || config.protections[type] === false) return null;
  if (config.protectedUserIds.includes(executor.id)) return null;

  let member;
  try {
    member = await guild.members.fetch(executor.id);
  } catch {
    return null;
  }

  if (config.safeRoleIds.some((id) => member.roles.cache.has(id))) return null;
  if (!hasProtectedPermission(member)) return null;

  const now = Date.now();
  const actions = getActions(guild.id, executor.id, type, now, config.windowMs);
  actions.push(now);
  trackers.set(key(guild.id, executor.id, type), actions);

  const limit = Math.max(1, Number(config.thresholds[type]) || DEFAULT_THRESHOLDS[type] || 3);
  if (actions.length < limit) return null;

  return openIncident({ db: client.db, guild, executor, type, member, actionCount: actions.length, config });
}

export async function antiChannelDelete(channel, executor, client) { return handleAction('channelDelete', channel.guild, executor, client); }
export async function antiChannelCreate(channel, executor, client) { return handleAction('channelCreate', channel.guild, executor, client); }
export async function antiRoleCreate(role, executor, client) { return handleAction('roleCreate', role.guild, executor, client); }
export async function antiRoleDelete(role, executor, client) { return handleAction('roleDelete', role.guild, executor, client); }
export async function antiBan(guild, executor, client) { return handleAction('ban', guild, executor, client); }

export function cleanupAntiNukeState() {
  const cutoff = Date.now() - 120000;
  for (const [k, values] of trackers) {
    const fresh = values.filter((t) => t > cutoff);
    if (fresh.length) trackers.set(k, fresh); else trackers.delete(k);
  }
  for (const [k, incident] of incidents) if (incident.createdAt <= cutoff) incidents.delete(k);
}
