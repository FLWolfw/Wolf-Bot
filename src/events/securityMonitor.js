import { AuditLogEvent, Events } from 'discord.js';
import { fetchExecutor } from '../utils/auditLog.js';
import { antiBan, antiChannelCreate, antiChannelDelete, antiRoleCreate, antiRoleDelete, antiRoleUpdate, antiMemberPermissionChange, cleanupAntiNukeState } from '../security/antiNuke.js';
import { persistAuditLogEntry, persistSecurityLog, enrichSecurityLog } from '../services/securityLogService.js';
import { logger } from '../utils/logger.js';

const EVENT_CONFIG = {
  [Events.ChannelCreate]: { audit: AuditLogEvent.ChannelCreate, type: 'channel.create', targetType: 'channel', anti: antiChannelCreate },
  [Events.ChannelDelete]: { audit: AuditLogEvent.ChannelDelete, type: 'channel.delete', targetType: 'channel', anti: antiChannelDelete },
  [Events.GuildRoleCreate]: { audit: AuditLogEvent.RoleCreate, type: 'role.create', targetType: 'role', anti: antiRoleCreate },
  [Events.GuildRoleDelete]: { audit: AuditLogEvent.RoleDelete, type: 'role.delete', targetType: 'role', anti: antiRoleDelete },
  [Events.GuildBanAdd]: { audit: AuditLogEvent.MemberBanAdd, type: 'moderation.ban', targetType: 'user', anti: antiBan },
};
function channelMetadata(channel) { return { name: channel?.name || null, id: channel?.id || null, type: channel?.type ?? null, typeName: channel?.type != null ? String(channel.type) : null, parentId: channel?.parentId || null, parentName: channel?.parent?.name || null, position: channel?.rawPosition ?? channel?.position ?? null, topic: channel?.topic || null, nsfw: channel?.nsfw ?? null, rateLimitPerUser: channel?.rateLimitPerUser ?? null, url: channel?.url || null }; }
function roleMetadata(role) { return { name: role?.name || null, id: role?.id || null, position: role?.rawPosition ?? role?.position ?? null, color: role?.hexColor || null, hoist: role?.hoist ?? null, mentionable: role?.mentionable ?? null, managed: role?.managed ?? null, permissions: role?.permissions?.toArray?.() || [] }; }
function targetMetadata(eventName, target) { if (eventName === Events.GuildRoleCreate || eventName === Events.GuildRoleDelete) return roleMetadata(target); if (eventName === Events.GuildBanAdd) { const user = target?.user || target; return { userId: user?.id || null, username: user?.username || null, globalName: user?.globalName || null, tag: user?.tag || null, bot: user?.bot ?? null }; } return channelMetadata(target); }

async function processEvent(client, eventName, target) {
  const guild = target?.guild; if (!guild) return; const cfg = EVENT_CONFIG[eventName]; if (!cfg) return;
  const targetId = target?.id || target?.user?.id || null;
  const logId = await persistSecurityLog(client.db, { guildId: guild.id, eventType: cfg.type, severity: 'warning', targetId, targetType: cfg.targetType, metadata: targetMetadata(eventName, target) });
  if (!logId) logger.error('Security event could not be persisted', { event: cfg.type, guildId: guild.id, targetId });
  const resolved = await fetchExecutor(guild, cfg.audit, targetId ? { targetId } : {}); const executor = resolved?.executor || null;
  if (logId) await enrichSecurityLog(client.db, logId, { executorId: executor?.id || null, executorTag: executor?.tag || executor?.username || null, auditLogId: resolved?.id || null, reason: resolved?.reason || null, metadata: { executor: executor ? { id: executor.id || null, tag: executor.tag || executor.username || null, username: executor.username || null, globalName: executor.globalName || null, bot: executor.bot ?? null } : null, audit: resolved ? { id: resolved.id || null, action: resolved.action ?? null, createdTimestamp: resolved.createdTimestamp || null, reason: resolved.reason || null, targetId: resolved.targetId || targetId || null, targetName: resolved.targetName || null, changes: resolved.changes || [], options: resolved.options || null } : null, resolved: Boolean(executor) } });
  if (cfg.anti === antiBan) await cfg.anti(guild, executor, client); else await cfg.anti(target, executor, client);
}

async function processMemberRoleUpdate(client, oldMember, newMember) {
  const guild = newMember?.guild || oldMember?.guild;
  if (!guild) return;
  const oldIds = new Set(oldMember.roles.cache.keys());
  const addedRoleIds = newMember.roles.cache.filter((role) => !oldIds.has(role.id)).map((role) => role.id);
  if (!addedRoleIds.length) return;

  const targetId = newMember.id;
  const resolved = await fetchExecutor(guild, AuditLogEvent.MemberRoleUpdate, { targetId });
  const executor = resolved?.executor || null;
  if (!executor || executor.bot || executor.id === guild.ownerId) return;

  await persistSecurityLog(client.db, {
    guildId: guild.id,
    eventType: 'member.role.add',
    severity: 'warning',
    executorId: executor.id,
    executorTag: executor.tag || executor.username || null,
    targetId,
    targetType: 'user',
    auditLogId: resolved?.id || null,
    reason: resolved?.reason || null,
    metadata: {
      targetUsername: newMember.user?.username || null,
      addedRoles: addedRoleIds.map((id) => {
        const role = guild.roles.cache.get(id);
        return role ? { id: role.id, name: role.name, position: role.position, permissions: role.permissions.toArray() } : { id };
      }),
      audit: resolved ? { id: resolved.id, changes: resolved.changes || [], options: resolved.options || null } : null,
    },
  });

  await antiMemberPermissionChange(newMember, executor, client, addedRoleIds);
}

async function processRoleUpdate(client, oldRole, newRole) {
  const guild = newRole?.guild;
  if (!guild) return;
  const dangerousChanged = oldRole.permissions.bitfield !== newRole.permissions.bitfield;
  const protectedChanged = oldRole.name !== newRole.name || oldRole.position !== newRole.position || oldRole.color !== newRole.color || oldRole.mentionable !== newRole.mentionable;
  if (!dangerousChanged && !protectedChanged) return;
  const resolved = await fetchExecutor(guild, AuditLogEvent.RoleUpdate, { targetId: newRole.id });
  const executor = resolved?.executor || null;
  if (!executor || executor.bot || executor.id === guild.ownerId) return;

  await persistSecurityLog(client.db, {
    guildId: guild.id,
    eventType: 'role.update',
    severity: dangerousChanged ? 'critical' : 'warning',
    executorId: executor.id,
    executorTag: executor.tag || executor.username || null,
    targetId: newRole.id,
    targetType: 'role',
    auditLogId: resolved?.id || null,
    reason: resolved?.reason || null,
    metadata: {
      role: { id: newRole.id, name: newRole.name, position: newRole.position, permissions: newRole.permissions.toArray(), color: newRole.hexColor, mentionable: newRole.mentionable },
      oldRole: { name: oldRole.name, position: oldRole.position, permissions: oldRole.permissions.toArray(), color: oldRole.hexColor, mentionable: oldRole.mentionable },
      dangerousPermissionsChanged: dangerousChanged,
      audit: resolved ? { id: resolved.id, changes: resolved.changes || [], options: resolved.options || null } : null,
    },
  });

  if (dangerousChanged) await antiRoleUpdate(newRole, executor, client);
}

async function processAuditEntry(client, entry, guild) { if (!entry || !guild) return; const saved = await persistAuditLogEntry(client.db, entry, guild.id); if (!saved) logger.debug('Audit log entry could not be persisted', { guildId: guild.id, auditLogId: entry.id }); }

export function registerSecurityMonitor(client) {
  if (!client || client.__wolfSecurityMonitorRegistered) return false; client.__wolfSecurityMonitorRegistered = true;
  for (const eventName of Object.keys(EVENT_CONFIG)) client.on(eventName, (target) => processEvent(client, eventName, target).catch((error) => logger.error('Security monitor failed', { event: eventName, error: error?.message })));
  client.on(Events.GuildMemberUpdate, (oldMember, newMember) => processMemberRoleUpdate(client, oldMember, newMember).catch((error) => logger.error('Security member-role monitor failed', { error: error?.message })));
  client.on(Events.GuildRoleUpdate, (oldRole, newRole) => processRoleUpdate(client, oldRole, newRole).catch((error) => logger.error('Security role monitor failed', { error: error?.message })));
  client.on(Events.GuildAuditLogEntryCreate, (entry, guild) => processAuditEntry(client, entry, guild).catch((error) => logger.error('Audit persistence failed', { error: error?.message })));
  const timer = setInterval(cleanupAntiNukeState, 60_000); timer.unref?.(); logger.info('🛡️ Wolf Security monitor registered', { events: Object.keys(EVENT_CONFIG), auditLogStream: true, privilegeEscalation: true }); return true;
}
export default { name: Events.ClientReady, once: true, async execute(readyClient, injectedClient) { registerSecurityMonitor(injectedClient || readyClient); } };
