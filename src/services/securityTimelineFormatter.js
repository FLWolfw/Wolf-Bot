export function buildIncidentTimeline(events = []) {
  return [...events]
    .filter(Boolean)
    .sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime())
    .map(event => ({
      timestamp: event.timestamp,
      actorId: event.executorId || event.actorId || null,
      actor: event.executor || event.actor || 'Desconocido',
      event: event.event || event.type || 'security.event',
      targetId: event.targetId || event.target || null,
      action: event.action || null,
      result: event.result || null,
      reason: event.reason || null,
      automated: event.automated === true,
      metadata: event.metadata || {},
    }));
}
