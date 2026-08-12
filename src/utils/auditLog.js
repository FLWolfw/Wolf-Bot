import { logger } from './logger.js';

/**
 * Resolve who performed an action via the guild audit log and keep the
 * complete audit entry details available to persistent security logs.
 */
export async function fetchExecutor(guild, auditType, opts = {}) {
  const { targetId = null, windowMs = 5000, delayMs = 600 } = opts;

  try {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));

    const logs = await guild.fetchAuditLogs({ limit: 10, type: auditType });
    const entry = logs.entries.find((e) => {
      if (Date.now() - e.createdTimestamp > windowMs) return false;
      if (targetId && e.target?.id !== targetId) return false;
      return true;
    });

    if (!entry?.executor) return null;

    return {
      id: entry.id,
      action: entry.action,
      text: `${entry.executor.tag || entry.executor.username} (${entry.executor.id})`,
      executor: entry.executor,
      reason: entry.reason || null,
      createdTimestamp: entry.createdTimestamp,
      changes: entry.changes?.map((change) => ({
        key: change.key,
        old: change.old ?? null,
        new: change.new ?? null,
      })) || [],
      options: entry.options ? {
        channelId: entry.options.channelId || null,
        count: entry.options.count || null,
        id: entry.options.id || null,
        roleName: entry.options.roleName || null,
        type: entry.options.type || null,
        membersRemoved: entry.options.membersRemoved || null,
        deleteMemberDays: entry.options.deleteMemberDays || null,
        messageId: entry.options.messageId || null,
      } : null,
      targetId: entry.target?.id || targetId || null,
      targetName: entry.target?.name || entry.target?.tag || entry.target?.username || null,
    };
  } catch (err) {
    logger?.debug?.(`auditLog: could not resolve executor (${err?.message || err})`);
    return null;
  }
}

export function executorText(result, fallback = 'No se pudo determinar') {
  return result?.text || fallback;
}
