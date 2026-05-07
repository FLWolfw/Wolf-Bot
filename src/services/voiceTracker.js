const activeSessions = new Map();

export function startSession(userId, channelId) {
  activeSessions.set(userId, {
    channelId,
    joinedAt: Date.now()
  });
}

export function endSession(userId) {
  const session = activeSessions.get(userId);
  if (!session) return null;

  const duration = Date.now() - session.joinedAt;
  activeSessions.delete(userId);

  return duration;
}

export function getSession(userId) {
  return activeSessions.get(userId);
}