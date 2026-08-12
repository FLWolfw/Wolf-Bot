const keyFor = (guildId, userId) => `guild:${guildId}:security:quarantine:${userId}`;

export async function getQuarantine(db, guildId, userId) {
  if (!db || !guildId || !userId) return null;
  return db.get(keyFor(guildId, userId), null);
}

export async function setQuarantine(db, guildId, userId, state) {
  if (!db || !guildId || !userId) return null;
  const value = {
    active: true,
    guildId,
    userId,
    createdAt: state?.createdAt || new Date().toISOString(),
    incidentId: state?.incidentId || null,
    reason: state?.reason || 'Wolf Anti-Nuke quarantine',
    originalRoleIds: Array.isArray(state?.originalRoleIds) ? [...new Set(state.originalRoleIds)] : [],
    timeoutUntil: state?.timeoutUntil || null,
  };
  await db.set(keyFor(guildId, userId), value);
  return value;
}

export async function updateQuarantine(db, guildId, userId, patch = {}) {
  const current = await getQuarantine(db, guildId, userId);
  if (!current?.active) return null;
  const next = { ...current, ...patch, active: true };
  await db.set(keyFor(guildId, userId), next);
  return next;
}

export async function clearQuarantine(db, guildId, userId) {
  if (!db || !guildId || !userId) return false;
  await db.set(keyFor(guildId, userId), null);
  return true;
}
