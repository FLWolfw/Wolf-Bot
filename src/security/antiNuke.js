import { PermissionsBitField } from 'discord.js';
import { createSecurityIncident, makeIncidentId, persistSecurityLog } from '../services/securityLogService.js';
import { logger } from '../utils/logger.js';

const trackers = new Map();
const incidents = new Map();

const LIMITS = {
  channelDelete: Number(process.env.ANTI_NUKE_CHANNEL_DELETE_LIMIT || 3),
  channelCreate: Number(process.env.ANTI_NUKE_CHANNEL_CREATE_LIMIT || 5),
  roleCreate: Number(process.env.ANTI_NUKE_ROLE_CREATE_LIMIT || 3),
  roleDelete: Number(process.env.ANTI_NUKE_ROLE_DELETE_LIMIT || 3),
  ban: Number(process.env.ANTI_NUKE_BAN_LIMIT || 3),
};

const WINDOW_MS = Number(process.env.ANTI_NUKE_WINDOW_MS || 10000);
const INCIDENT_WINDOW_MS = Number(process.env.ANTI_NUKE_INCIDENT_WINDOW_MS || 30000);
const SAFE_ROLES = new Set((process.env.ANTI_NUKE_SAFE_ROLE_IDS || '1231565813597863946,1453091584185860268')
  .split(',').map((id) => id.trim()).filter(Boolean));

function key(guildId, executorId, type) {
  return `${guildId}:${executorId}:${type}`;
}

function getActions(guildId, executorId, type, now) {
  const k = key(guildId, executorId, type);
  const actions = (trackers.get(k) || []).filter((t) => now - t < WINDOW_MS);
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

async function quarantine(member, reason) {
  try {
    if (member.manageable) {
      await member.roles.set([], reason).catch(() => {});
      if (member.moderatable) await member.timeout(60 * 60 * 1000, reason).catch(() => {});
      return 'quarantine';
    }
  } catch (error) {
    logger.error('Anti-nuke quarantine failed', { error: error?.message });
  }
  return 'alert_only';
}

async function openIncident({ db, guild, executor, type, member, actionCount }) {
  const incidentKey = `${guild.id}:${executor.id}`;
  const existing = incidents.get(incidentKey);
  if (existing && Date.now() - existing.createdAt < INCIDENT_WINDOW_MS) return existing;

  const incidentId = makeIncidentId();
  const actionTaken = await quarantine(member, `Wolf Anti-Nuke: ${type}`);
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
    metadata: { actionCount, limit: LIMITS[type] || null },
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
    reason: `Threshold exceeded for ${type}`,
    metadata: { actionCount, limit: LIMITS[type] || null, actionTaken },
  });

  logger.warn('🚨 Anti-Nuke incident', { guildId: guild.id, executorId: executor.id, type, actionCount, actionTaken, incidentId });
  return incident;
}

async function handleAction(type, guild, executor, client) {
  if (!guild || !executor || executor.bot || executor.id === guild.ownerId) return null;

  let member;
  try { member = await guild.members.fetch(executor.id); } catch { return null; }
  if (SAFE_ROLES.size && [...SAFE_ROLES].some((id) => member.roles.cache.has(id))) return null;
  if (!hasProtectedPermission(member)) return null;

  const now = Date.now();
  const actions = getActions(guild.id, executor.id, type, now);
  actions.push(now);
  trackers.set(key(guild.id, executor.id, type), actions);
  if (actions.length < (LIMITS[type] || Number.MAX_SAFE_INTEGER)) return null;

  return openIncident({ db: client.db, guild, executor, type, member, actionCount: actions.length });
}

export async function antiChannelDelete(channel, executor, client) { return handleAction('channelDelete', channel.guild, executor, client); }
export async function antiChannelCreate(channel, executor, client) { return handleAction('channelCreate', channel.guild, executor, client); }
export async function antiRoleCreate(role, executor, client) { return handleAction('roleCreate', role.guild, executor, client); }
export async function antiRoleDelete(role, executor, client) { return handleAction('roleDelete', role.guild, executor, client); }
export async function antiBan(guild, executor, client) { return handleAction('ban', guild, executor, client); }

export function cleanupAntiNukeState() {
  const cutoff = Date.now() - Math.max(WINDOW_MS, INCIDENT_WINDOW_MS) * 2;
  for (const [k, values] of trackers) {
    const fresh = values.filter((t) => t > cutoff);
    if (fresh.length) trackers.set(k, fresh); else trackers.delete(k);
  }
  for (const [k, incident] of incidents) if (incident.createdAt <= cutoff) incidents.delete(k);
}
