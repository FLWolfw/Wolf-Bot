export async function appendSecurityTimeline(db, guildId, incidentId, entry) {
  if (!db || !guildId || !incidentId) return null;
  const key = `security:timeline:${guildId}:${incidentId}`;
  const current = await db.get(key, []);
  const timeline = Array.isArray(current) ? current : [];
  timeline.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  });
  // Keep incident timelines bounded while preserving the newest events.
  const bounded = timeline.slice(-200);
  await db.set(key, bounded);
  return bounded.at(-1);
}

export async function getSecurityTimeline(db, guildId, incidentId) {
  if (!db || !guildId || !incidentId) return [];
  const value = await db.get(`security:timeline:${guildId}:${incidentId}`, []);
  return Array.isArray(value) ? value : [];
}
