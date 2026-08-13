import { Events } from 'discord.js';
import { logger } from '../utils/logger.js';

const OWNER_LOGS = 'owner_security_logs';
const OWNER_INCIDENTS = 'owner_security_incidents';

function poolOf(client) {
  return client?.db?.pool || client?.db?.db?.pool || null;
}

function snapshot(guild, status = 'active') {
  return {
    id: guild.id,
    name: guild.name || null,
    icon: guild.iconURL?.({ extension: 'png', size: 256 }) || null,
    ownerId: guild.ownerId || null,
    memberCount: guild.memberCount ?? null,
    status,
    capturedAt: new Date().toISOString(),
  };
}

async function ensureColumns(pool) {
  await pool.query(`ALTER TABLE ${OWNER_LOGS} ADD COLUMN IF NOT EXISTS guild_snapshot JSONB DEFAULT '{}'`);
  await pool.query(`ALTER TABLE ${OWNER_INCIDENTS} ADD COLUMN IF NOT EXISTS guild_snapshot JSONB DEFAULT '{}'`);
}

async function saveGuildSnapshot(client, guild, status = 'active') {
  const pool = poolOf(client);
  if (!pool || !guild?.id) return;

  try {
    await ensureColumns(pool);
    const data = snapshot(guild, status);
    const json = JSON.stringify(data);
    const displayName = status === 'active' ? data.name : `${data.name || `Servidor ${data.id}`} [Wolf ya no está]`;

    await pool.query(
      `UPDATE ${OWNER_LOGS}
       SET guild_name = $2,
           guild_snapshot = COALESCE(guild_snapshot, '{}'::jsonb) || $3::jsonb,
           metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('guildSnapshot', $3::jsonb)
       WHERE guild_id = $1`,
      [guild.id, displayName, json]
    );

    await pool.query(
      `UPDATE ${OWNER_INCIDENTS}
       SET guild_name = $2,
           guild_snapshot = COALESCE(guild_snapshot, '{}'::jsonb) || $3::jsonb,
           metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('guildSnapshot', $3::jsonb)
       WHERE guild_id = $1`,
      [guild.id, displayName, json]
    );
  } catch (error) {
    logger.warn('Security guild snapshot failed', { guildId: guild.id, status, error: error?.message });
  }
}

async function snapshotAll(client) {
  for (const guild of client.guilds.cache.values()) {
    await saveGuildSnapshot(client, guild, 'active');
  }
}

export default {
  name: Events.ClientReady,
  once: true,
  async execute(readyClient) {
    await snapshotAll(readyClient);
    logger.info('🗄️ Security Vault guild snapshots synchronized', { guilds: readyClient.guilds.cache.size });

    readyClient.on(Events.GuildCreate, (guild) => saveGuildSnapshot(readyClient, guild, 'active'));
    readyClient.on(Events.GuildUpdate, (_oldGuild, newGuild) => saveGuildSnapshot(readyClient, newGuild, 'active'));
    readyClient.on(Events.GuildDelete, (guild) => saveGuildSnapshot(readyClient, guild, 'unavailable'));

    const timer = setInterval(() => snapshotAll(readyClient), 5 * 60 * 1000);
    timer.unref?.();
  },
};
