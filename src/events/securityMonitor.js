import { AuditLogEvent, Events } from 'discord.js';
import { fetchExecutor } from '../utils/auditLog.js';
import { antiBan, antiChannelCreate, antiChannelDelete, antiRoleCreate, antiRoleDelete, cleanupAntiNukeState } from '../security/antiNuke.js';
import { persistSecurityLog } from '../services/securityLogService.js';
import { logger } from '../utils/logger.js';

const EVENT_CONFIG = {
  [Events.ChannelCreate]: { audit: AuditLogEvent.ChannelCreate, type: 'channel.create', targetType: 'channel', anti: antiChannelCreate },
  [Events.ChannelDelete]: { audit: AuditLogEvent.ChannelDelete, type: 'channel.delete', targetType: 'channel', anti: antiChannelDelete },
  [Events.GuildRoleCreate]: { audit: AuditLogEvent.RoleCreate, type: 'role.create', targetType: 'role', anti: antiRoleCreate },
  [Events.GuildRoleDelete]: { audit: AuditLogEvent.RoleDelete, type: 'role.delete', targetType: 'role', anti: antiRoleDelete },
  [Events.GuildBanAdd]: { audit: AuditLogEvent.MemberBanAdd, type: 'moderation.ban', targetType: 'user', anti: antiBan },
};

async function processEvent(client, eventName, target) {
  const guild = target?.guild;
  if (!guild) return;
  const cfg = EVENT_CONFIG[eventName];
  if (!cfg) return;

  const targetId = target?.id || target?.user?.id || null;
  const baseRecord = {
    guildId: guild.id,
    eventType: cfg.type,
    severity: 'warning',
    targetId,
    targetType: cfg.targetType,
    metadata: { name: target?.name || target?.user?.tag || null },
  };

  // Persist first. Audit Log resolution is enrichment, never a prerequisite.
  const saved = await persistSecurityLog(client.db, baseRecord);
  if (!saved) {
    logger.error('Security event could not be persisted', { event: cfg.type, guildId: guild.id, targetId });
  }

  const resolved = await fetchExecutor(guild, cfg.audit, targetId ? { targetId } : {});
  const executor = resolved?.executor || null;

  if (executor) {
    await persistSecurityLog(client.db, {
      ...baseRecord,
      eventType: `${cfg.type}.resolved`,
      executorId: executor.id || null,
      executorTag: executor.tag || executor.username || null,
      auditLogId: resolved.id || null,
      reason: resolved.reason || null,
    });
  }

  if (cfg.anti === antiBan) await cfg.anti(guild, executor, client);
  else await cfg.anti(target, executor, client);
}

export function registerSecurityMonitor(client) {
  if (!client || client.__wolfSecurityMonitorRegistered) return false;
  client.__wolfSecurityMonitorRegistered = true;

  for (const eventName of Object.keys(EVENT_CONFIG)) {
    client.on(eventName, (target) => processEvent(client, eventName, target).catch((error) => {
      logger.error('Security monitor failed', { event: eventName, error: error?.message });
    }));
  }

  const timer = setInterval(cleanupAntiNukeState, 60_000);
  timer.unref?.();
  logger.info('🛡️ Wolf Security monitor registered', { events: Object.keys(EVENT_CONFIG) });
  return true;
}

export default {
  name: Events.ClientReady,
  once: true,
  async execute(readyClient, injectedClient) {
    registerSecurityMonitor(injectedClient || readyClient);
  },
};
