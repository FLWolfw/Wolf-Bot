import { PermissionsBitField } from 'discord.js';
import { getGuildConfig } from '../services/guildConfigService.js';
import { createSecurityIncident, persistSecurityLog } from '../services/securityLogService.js';
import { getQuarantine, setQuarantine, updateQuarantine } from '../services/quarantineService.js';
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
  dangerousPermission: 1,
};

const DEFAULT_WINDOW_MS = 10000;
const DEFAULT_INCIDENT_WINDOW_MS = 30000;
const DEFAULT_QUARANTINE_TIMEOUT_MS = 60 * 60 * 1000;

function key(guildId, executorId, type) {
  return `${guildId}:${executorId}:${type}`;
}

function normalizeConfig(config) {
  const anti = config?.antiNuke || {};
  return {
    enabled: anti.enabled !== false,
    emergencyMode: anti.emergencyMode !== false,
    windowMs: Math.min(60000, Math.max(1000, Number(anti.windowMs) || DEFAULT_WINDOW_MS)),
    incidentWindowMs: Math.min(120000, Math.max(5000, Number(anti.incidentWindowMs) || DEFAULT_INCIDENT_WINDOW_MS)),
    action: ['alert', 'quarantine', 'ban'].includes(anti.action) ? anti.action : 'quarantine',
    quarantinePersistent: anti.quarantinePersistent !== false,
    quarantineBypassAction: ['alert', 're_quarantine', 'ban'].includes(anti.quarantineBypassAction) ? anti.quarantineBypassAction : 're_quarantine',
    quarantineTimeoutMs: Math.min(28 * 24 * 60 * 60 * 1000, Math.max(60 * 1000, Number(anti.quarantineTimeoutMs) || DEFAULT_QUARANTINE_TIMEOUT_MS)),
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

function hasDangerousPermissions(role) {
  if (!role?.permissions) return false;
  const flags = [
    PermissionsBitField.Flags.Administrator,
    PermissionsBitField.Flags.ManageGuild,
    PermissionsBitField.Flags.ManageRoles,
    PermissionsBitField.Flags.ManageChannels,
    PermissionsBitField.Flags.BanMembers,
    PermissionsBitField.Flags.KickMembers,
    PermissionsBitField.Flags.ManageWebhooks,
  ];
  return flags.some((flag) => role.permissions.has(flag));
}

function dangerousPermissionNames(role) {
  if (!role?.permissions) return [];
  const names = [
    ['Administrator', PermissionsBitField.Flags.Administrator],
    ['ManageGuild', PermissionsBitField.Flags.ManageGuild],
    ['ManageRoles', PermissionsBitField.Flags.ManageRoles],
    ['ManageChannels', PermissionsBitField.Flags.ManageChannels],
    ['BanMembers', PermissionsBitField.Flags.BanMembers],
    ['KickMembers', PermissionsBitField.Flags.KickMembers],
    ['ManageWebhooks', PermissionsBitField.Flags.ManageWebhooks],
  ];
  return names.filter(([, flag]) => role.permissions.has(flag)).map(([name]) => name);
}

async function takeAction(member, action, reason, { db, incidentId, quarantineTimeoutMs } = {}) {
  if (action === 'alert') return 'alert_only';

  try {
    if (action === 'ban' && member.bannable) {
      await member.ban({ reason });
      return 'ban';
    }

    if (action === 'quarantine' && member.manageable) {
      const existing = await getQuarantine(db, member.guild.id, member.id);
      const previousRoleIds = existing?.active
        ? existing.originalRoleIds
        : member.roles.cache.filter((r) => r.id !== member.guild.id).map((r) => r.id);
      const timeoutUntil = new Date(Date.now() + quarantineTimeoutMs).toISOString();

      if (db) {
        await setQuarantine(db, member.guild.id, member.id, {
          incidentId,
          reason,
          originalRoleIds: previousRoleIds,
          timeoutUntil,
        });
      }

      await member.roles.set([], reason);
      if (member.moderatable) {
        await member.timeout(quarantineTimeoutMs, reason).catch(() => {});
      }
      return 'quarantine';
    }
  } catch (error) {
    logger.error('Anti-nuke action failed', { action, error: error?.message });
  }

  return 'alert_only';
}

async function openIncident({ db, guild, executor, type, member, actionCount, config, emergency = false, metadata = {} }) {
  const incidentKey = `${guild.id}:${executor.id}:${type}`;
  const existing = incidents.get(incidentKey);
  if (existing && Date.now() - existing.createdAt < config.incidentWindowMs) return existing;

  const incidentId = `INC-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.random().toString(16).slice(2, 10).toUpperCase()}`;
  const threshold = config.thresholds[type] || 1;
  const reason = emergency
    ? `Wolf Emergency Anti-Nuke: dangerous action detected (${type})`
    : `Wolf Anti-Nuke: ${type} threshold exceeded (${actionCount}/${threshold})`;
  const actionTaken = await takeAction(member, config.action, reason, {
    db,
    incidentId,
    quarantineTimeoutMs: config.quarantineTimeoutMs,
  });
  const incident = { incidentId, createdAt: Date.now(), actionTaken };
  incidents.set(incidentKey, incident);

  const common = {
    actionCount,
    limit: threshold,
    windowMs: config.windowMs,
    configuredAction: config.action,
    quarantinePersistent: config.quarantinePersistent,
    quarantineBypassAction: config.quarantineBypassAction,
    quarantineTimeoutMs: config.quarantineTimeoutMs,
    emergency,
    memberManageable: Boolean(member?.manageable),
    memberModeratable: Boolean(member?.moderatable),
    memberBannable: Boolean(member?.bannable),
    hierarchyBlocked: actionTaken === 'alert_only' && config.action !== 'alert',
    ...metadata,
  };

  await createSecurityIncident(db, {
    incidentId,
    guildId: guild.id,
    executorId: executor.id,
    executorTag: executor.tag || executor.username || executor.id,
    severity: 'critical',
    triggerType: type,
    actionTaken,
    metadata: common,
  });

  await persistSecurityLog(db, {
    guildId: guild.id,
    incidentId,
    eventType: emergency ? `emergency.${type}` : `anti_nuke.${type}`,
    severity: 'critical',
    executorId: executor.id,
    executorTag: executor.tag || executor.username || executor.id,
    targetId: executor.id,
    targetType: 'user',
    reason,
    metadata: common,
  });

  logger.warn('🚨 Anti-Nuke incident', {
    guildId: guild.id,
    executorId: executor.id,
    type,
    actionCount,
    actionTaken,
    emergency,
    incidentId,
  });
  return incident;
}

export async function enforceQuarantine(member, state, client, reason = 'Wolf Anti-Nuke: quarantine enforcement') {
  if (!member?.guild || !state?.active || !client?.db) return { action: 'none', removedRoleIds: [], timeoutApplied: false };
  const removedRoleIds = [];
  let timeoutApplied = false;

  try {
    if (member.manageable) {
      const removable = member.roles.cache.filter((role) => role.id !== member.guild.id && role.editable);
      if (removable.size) {
        removedRoleIds.push(...removable.map((role) => role.id));
        await member.roles.remove(removable, reason);
      }
    }
    if (member.moderatable) {
      const until = state.timeoutUntil ? new Date(state.timeoutUntil).getTime() : Date.now() + DEFAULT_QUARANTINE_TIMEOUT_MS;
      const duration = Math.max(60 * 1000, until - Date.now());
      await member.timeout(duration, reason).catch(() => {});
      timeoutApplied = true;
      await updateQuarantine(client.db, member.guild.id, member.id, { timeoutUntil: new Date(Date.now() + duration).toISOString() });
    }
  } catch (error) {
    logger.warn('Quarantine enforcement failed', { guildId: member.guild.id, userId: member.id, error: error?.message });
  }

  return { action: 're_quarantine', removedRoleIds, timeoutApplied };
}

export async function handleQuarantineBypass(member, executor, client, metadata = {}) {
  if (!member?.guild || !client?.db) return null;
  const state = await getQuarantine(client.db, member.guild.id, member.id);
  if (!state?.active) return null;

  const config = normalizeConfig(await getGuildConfig(client.db, member.guild.id));
  const action = config.quarantineBypassAction;
  const reason = `Wolf Anti-Nuke: quarantine bypass detected${executor?.id ? ` by ${executor.tag || executor.username || executor.id}` : ''}`;

  let result = 'alert_only';
  if (action === 'ban' && member.bannable) {
    try {
      await member.ban({ reason });
      result = 'ban';
    } catch (error) {
      logger.warn('Quarantine bypass ban failed', { guildId: member.guild.id, userId: member.id, error: error?.message });
      result = 'alert_only';
    }
  } else if (action === 're_quarantine') {
    const enforcement = await enforceQuarantine(member, state, client, reason);
    result = enforcement.action;
  }

  await persistSecurityLog(client.db, {
    guildId: member.guild.id,
    eventType: 'anti_nuke.quarantine_bypass',
    severity: action === 'ban' ? 'critical' : 'warning',
    executorId: executor?.id || null,
    executorTag: executor?.tag || executor?.username || null,
    targetId: member.id,
    targetType: 'user',
    reason,
    metadata: {
      quarantineIncidentId: state.incidentId,
      configuredAction: action,
      actionTaken: result,
      originalRoleIds: state.originalRoleIds || [],
      ...metadata,
    },
  });

  return { state, actionTaken: result };
}

async function handleAction(type, guild, executor, client, options = {}) {
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

  if (options.immediate && config.emergencyMode) {
    return openIncident({
      db: client.db,
      guild,
      executor,
      type,
      member,
      actionCount: 1,
      config,
      emergency: true,
      metadata: options.metadata || {},
    });
  }

  if (!hasProtectedPermission(member)) return null;

  const now = Date.now();
  const actions = getActions(guild.id, executor.id, type, now, config.windowMs);
  actions.push(now);
  trackers.set(key(guild.id, executor.id, type), actions);

  const limit = Math.max(1, Number(config.thresholds[type]) || DEFAULT_THRESHOLDS[type] || 3);
  if (actions.length < limit) return null;

  return openIncident({ db: client.db, guild, executor, type, member, actionCount: actions.length, config, metadata: options.metadata || {} });
}

export async function antiChannelDelete(channel, executor, client) { return handleAction('channelDelete', channel.guild, executor, client); }
export async function antiChannelCreate(channel, executor, client) { return handleAction('channelCreate', channel.guild, executor, client); }
export async function antiRoleCreate(role, executor, client) {
  const dangerous = hasDangerousPermissions(role);
  return handleAction('roleCreate', role.guild, executor, client, dangerous ? {
    immediate: true,
    metadata: {
      dangerousRole: true,
      roleId: role.id,
      roleName: role.name,
      permissions: dangerousPermissionNames(role),
    },
  } : {});
}
export async function antiRoleDelete(role, executor, client) {
  const config = normalizeConfig(await getGuildConfig(client.db, role.guild.id));
  const protectedRole = config.protectedRoleIds.includes(role.id);
  return handleAction('roleDelete', role.guild, executor, client, protectedRole ? {
    immediate: true,
    metadata: { protectedRole: true, roleId: role.id, roleName: role.name },
  } : {});
}
export async function antiBan(guild, executor, client) { return handleAction('ban', guild, executor, client); }
export async function antiRoleUpdate(role, executor, client) {
  if (!role?.guild) return null;
  const config = normalizeConfig(await getGuildConfig(client.db, role.guild.id));
  const protectedRole = config.protectedRoleIds.includes(role.id);
  const dangerous = hasDangerousPermissions(role);
  if (!protectedRole && !dangerous) return null;
  return handleAction('dangerousPermission', role.guild, executor, client, {
    immediate: true,
    metadata: {
      protectedRole,
      dangerousRole: dangerous,
      roleId: role.id,
      roleName: role.name,
      permissions: dangerousPermissionNames(role),
    },
  });
}
export async function antiMemberPermissionChange(member, executor, client, addedRoleIds = []) {
  if (!member?.guild || !addedRoleIds.length) return null;
  const dangerousRoles = addedRoleIds
    .map((id) => member.guild.roles.cache.get(id))
    .filter((role) => role && hasDangerousPermissions(role));
  if (!dangerousRoles.length) return null;
  return handleAction('dangerousPermission', member.guild, executor, client, {
    immediate: true,
    metadata: {
      targetUserId: member.id,
      targetUsername: member.user?.username || null,
      dangerousRoleIds: dangerousRoles.map((r) => r.id),
      dangerousRoles: dangerousRoles.map((r) => ({ id: r.id, name: r.name, permissions: dangerousPermissionNames(r) })),
    },
  });
}

export function cleanupAntiNukeState() {
  const cutoff = Date.now() - 120000;
  for (const [k, values] of trackers) {
    const fresh = values.filter((t) => t > cutoff);
    if (fresh.length) trackers.set(k, fresh); else trackers.delete(k);
  }
  for (const [k, incident] of incidents) if (incident.createdAt <= cutoff) incidents.delete(k);
}
