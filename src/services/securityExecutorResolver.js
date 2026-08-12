export async function resolveAuditExecutor(guild, targetUserId, { actionTypes = [], maxAgeMs = 15000 } = {}) {
  try {
    if (!guild?.fetchAuditLogs) return null;
    const audit = await guild.fetchAuditLogs({ limit: 25 });
    const now = Date.now();
    for (const entry of audit.entries.values()) {
      const created = entry.createdTimestamp || 0;
      if (now - created > maxAgeMs) continue;
      if (actionTypes.length && !actionTypes.includes(entry.action)) continue;
      const targetId = entry.target?.id || entry.targetId || entry.target_id || null;
      if (targetUserId && targetId && targetId !== targetUserId) continue;
      const executor = entry.executor;
      if (!executor || executor.bot) continue;
      return {
        id: executor.id,
        username: executor.username || executor.tag || executor.globalName || 'Desconocido',
        tag: executor.tag || executor.username || 'Desconocido',
        auditLogId: entry.id,
        action: entry.action,
        createdTimestamp: created,
        reason: entry.reason || null,
      };
    }
  } catch {
    // Audit logs can race with Discord propagation; callers should retain a null executor.
  }
  return null;
}
