import { logger } from '../utils/logger.js';

const INDEX_KEY = 'security:identity:index';
const USER_KEY = (userId) => `security:identity:${userId}`;
const MAX_HISTORY = 100;

function avatarUrl(user) {
  try {
    return user?.displayAvatarURL({ dynamic: true, size: 256 }) || null;
  } catch {
    return null;
  }
}

function clone(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
}

export async function recordUserIdentity(db, { user, guildId = null, guildName = null, reason = 'observed', previous = null } = {}) {
  if (!db || !user?.id) return false;
  try {
    const key = USER_KEY(user.id);
    const existing = (await db.get(key, null)) || {
      userId: user.id,
      current: null,
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: null,
      guilds: {},
      history: [],
    };

    const current = {
      username: user.username || null,
      globalName: user.globalName || null,
      avatar: avatarUrl(user),
      avatarHash: user.avatar || null,
    };

    const old = previous || existing.current;
    const changes = [];
    if (old) {
      if (old.username !== current.username) changes.push({ type: 'username', from: old.username, to: current.username });
      if (old.globalName !== current.globalName) changes.push({ type: 'display_name', from: old.globalName, to: current.globalName });
      if (old.avatarHash !== current.avatarHash) changes.push({ type: 'avatar', from: old.avatar, to: current.avatar });
    }

    if (guildId) {
      existing.guilds[guildId] = {
        guildId,
        guildName: guildName || existing.guilds[guildId]?.guildName || null,
        lastSeenAt: new Date().toISOString(),
      };
    }

    if (changes.length || !existing.current) {
      existing.history = [
        ...existing.history,
        {
          at: new Date().toISOString(),
          reason,
          guildId,
          guildName,
          username: current.username,
          globalName: current.globalName,
          avatar: current.avatar,
          avatarHash: current.avatarHash,
          changes,
        },
      ].slice(-MAX_HISTORY);
    }

    existing.current = current;
    existing.lastSeenAt = new Date().toISOString();
    await db.set(key, clone(existing));

    const index = Array.isArray(await db.get(INDEX_KEY, [])) ? await db.get(INDEX_KEY, []) : [];
    if (!index.includes(user.id)) {
      index.push(user.id);
      await db.set(INDEX_KEY, index.slice(-10000));
    }
    return true;
  } catch (error) {
    logger.warn('Failed to persist user identity history', { userId: user?.id, error: error?.message });
    return false;
  }
}

export async function getUserIdentity(db, userId) {
  if (!db || !userId) return null;
  return db.get(USER_KEY(String(userId)), null);
}

export async function listUserIdentities(db, search = '', limit = 100) {
  if (!db) return [];
  const index = await db.get(INDEX_KEY, []);
  const ids = Array.isArray(index) ? index.slice().reverse() : [];
  const needle = String(search || '').trim().toLowerCase();
  const rows = [];
  for (const id of ids) {
    if (rows.length >= Math.min(Number(limit) || 100, 500)) break;
    const profile = await getUserIdentity(db, id);
    if (!profile) continue;
    const haystack = [profile.userId, profile.current?.username, profile.current?.globalName, ...Object.values(profile.guilds || {}).map((g) => g.guildName)].filter(Boolean).join(' ').toLowerCase();
    if (needle && !haystack.includes(needle)) continue;
    rows.push(profile);
  }
  return rows;
}
