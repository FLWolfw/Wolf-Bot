import { randomUUID } from 'node:crypto';
import { AuditLogEvent } from 'discord.js';
import { logger } from '../utils/logger.js';

const TABLE_LOGS = 'security_logs';
const TABLE_INCIDENTS = 'security_incidents';
const TABLE_OWNER_LOGS = 'owner_security_logs';
const TABLE_OWNER_INCIDENTS = 'owner_security_incidents';
let schemaPromise = null;
function getPool(db) { return db?.pool || db?.db?.pool || null; }
function available(db) { return Boolean(db?.isAvailable?.() && getPool(db)); }
function auditName(action) { return Object.keys(AuditLogEvent).find((key) => AuditLogEvent[key] === action) || String(action); }
const DEDUPE_EVENT = { ChannelCreate: 'channel.create', ChannelDelete: 'channel.delete', RoleCreate: 'role.create', RoleDelete: 'role.delete', MemberBanAdd: 'moderation.ban' };
export function makeIncidentId() { return `INC-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8).toUpperCase()}`; }

export async function ensureSecurityTables(db) {
  const pool = getPool(db); if (!available(db)) return false; if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE_INCIDENTS} (incident_id VARCHAR(64) PRIMARY KEY, guild_id VARCHAR(20) NOT NULL, executor_id VARCHAR(20), executor_tag VARCHAR(200), severity VARCHAR(20) NOT NULL, trigger_type VARCHAR(80) NOT NULL, action_taken VARCHAR(80), metadata JSONB DEFAULT '{}', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE_LOGS} (id BIGSERIAL PRIMARY KEY, guild_id VARCHAR(20) NOT NULL, incident_id VARCHAR(64), event_type VARCHAR(100) NOT NULL, severity VARCHAR(20) NOT NULL, executor_id VARCHAR(20), executor_tag VARCHAR(200), target_id VARCHAR(30), target_type VARCHAR(50), audit_log_id VARCHAR(30), reason TEXT, metadata JSONB DEFAULT '{}', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE_OWNER_INCIDENTS} (incident_id VARCHAR(64) PRIMARY KEY, guild_id VARCHAR(20) NOT NULL, guild_name VARCHAR(200), executor_id VARCHAR(20), executor_tag VARCHAR(200), severity VARCHAR(20) NOT NULL, trigger_type VARCHAR(80) NOT NULL, action_taken VARCHAR(80), metadata JSONB DEFAULT '{}', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE_OWNER_LOGS} (id BIGSERIAL PRIMARY KEY, source_log_id BIGINT, guild_id VARCHAR(20) NOT NULL, guild_name VARCHAR(200), incident_id VARCHAR(64), event_type VARCHAR(100) NOT NULL, severity VARCHAR(20) NOT NULL, executor_id VARCHAR(20), executor_tag VARCHAR(200), target_id VARCHAR(30), target_type VARCHAR(50), audit_log_id VARCHAR(30), reason TEXT, metadata JSONB DEFAULT '{}', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_security_logs_guild_created ON ${TABLE_LOGS}(guild_id, created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_security_logs_incident ON ${TABLE_LOGS}(incident_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_security_logs_audit ON ${TABLE_LOGS}(audit_log_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_security_incidents_guild_created ON ${TABLE_INCIDENTS}(guild_id, created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_owner_security_logs_guild_created ON ${TABLE_OWNER_LOGS}(guild_id, created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_owner_security_logs_incident ON ${TABLE_OWNER_LOGS}(incident_id)`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_owner_security_logs_source ON ${TABLE_OWNER_LOGS}(source_log_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_owner_security_incidents_guild_created ON ${TABLE_OWNER_INCIDENTS}(guild_id, created_at DESC)`);
    await pool.query(`INSERT INTO ${TABLE_OWNER_INCIDENTS} (incident_id, guild_id, guild_name, executor_id, executor_tag, severity, trigger_type, action_taken, metadata, created_at) SELECT incident_id, guild_id, NULL, executor_id, executor_tag, severity, trigger_type, action_taken, metadata, created_at FROM ${TABLE_INCIDENTS} ON CONFLICT (incident_id) DO NOTHING`);
    await pool.query(`INSERT INTO ${TABLE_OWNER_LOGS} (source_log_id, guild_id, guild_name, incident_id, event_type, severity, executor_id, executor_tag, target_id, target_type, audit_log_id, reason, metadata, created_at) SELECT id, guild_id, NULL, incident_id, event_type, severity, executor_id, executor_tag, target_id, target_type, audit_log_id, reason, metadata, created_at FROM ${TABLE_LOGS} ON CONFLICT (source_log_id) DO NOTHING`);
    return true;
  })().catch((error) => { schemaPromise = null; logger.error('Security tables initialization failed', { error: error?.message }); return false; });
  return schemaPromise;
}

async function mirrorOwnerLog(pool, sourceLogId, record) {
  try {
    await pool.query(`INSERT INTO ${TABLE_OWNER_LOGS} (source_log_id, guild_id, guild_name, incident_id, event_type, severity, executor_id, executor_tag, target_id, target_type, audit_log_id, reason, metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (source_log_id) DO UPDATE SET guild_name = COALESCE(EXCLUDED.guild_name, ${TABLE_OWNER_LOGS}.guild_name), incident_id = COALESCE(EXCLUDED.incident_id, ${TABLE_OWNER_LOGS}.incident_id), executor_id = COALESCE(EXCLUDED.executor_id, ${TABLE_OWNER_LOGS}.executor_id), executor_tag = COALESCE(EXCLUDED.executor_tag, ${TABLE_OWNER_LOGS}.executor_tag), metadata = COALESCE(${TABLE_OWNER_LOGS}.metadata, '{}'::jsonb) || EXCLUDED.metadata`, [sourceLogId, record.guildId, record.guildName || record.metadata?.guildName || null, record.incidentId || null, record.eventType || 'unknown', record.severity || 'info', record.executorId || null, record.executorTag || null, record.targetId || null, record.targetType || null, record.auditLogId || null, record.reason || null, record.metadata || {}]);
  } catch (error) { logger.error('Failed to mirror security log to owner archive', { error: error?.message, guildId: record.guildId, sourceLogId }); }
}

async function mirrorOwnerIncident(pool, incidentId, record) {
  try {
    await pool.query(`INSERT INTO ${TABLE_OWNER_INCIDENTS} (incident_id, guild_id, guild_name, executor_id, executor_tag, severity, trigger_type, action_taken, metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (incident_id) DO UPDATE SET guild_name = COALESCE(EXCLUDED.guild_name, ${TABLE_OWNER_INCIDENTS}.guild_name), executor_id = COALESCE(EXCLUDED.executor_id, ${TABLE_OWNER_INCIDENTS}.executor_id), executor_tag = COALESCE(EXCLUDED.executor_tag, ${TABLE_OWNER_INCIDENTS}.executor_tag), action_taken = COALESCE(EXCLUDED.action_taken, ${TABLE_OWNER_INCIDENTS}.action_taken), metadata = ${TABLE_OWNER_INCIDENTS}.metadata || EXCLUDED.metadata`, [incidentId, record.guildId, record.guildName || record.metadata?.guildName || null, record.executorId || null, record.executorTag || null, record.severity || 'critical', record.triggerType || 'unknown', record.actionTaken || null, record.metadata || {}]);
  } catch (error) { logger.error('Failed to mirror security incident to owner archive', { error: error?.message, guildId: record.guildId, incidentId }); }
}

export async function persistSecurityLog(db, record = {}) {
  try {
    const pool = getPool(db); if (!(await ensureSecurityTables(db)) || !pool) return false;
    const result = await pool.query(`INSERT INTO ${TABLE_LOGS} (guild_id, incident_id, event_type, severity, executor_id, executor_tag, target_id, target_type, audit_log_id, reason, metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`, [record.guildId, record.incidentId || null, record.eventType || 'unknown', record.severity || 'info', record.executorId || null, record.executorTag || null, record.targetId || null, record.targetType || null, record.auditLogId || null, record.reason || null, record.metadata || {}]);
    const id = result.rows[0]?.id || false;
    if (id) await mirrorOwnerLog(pool, id, record);
    return id;
  } catch (error) { logger.error('Failed to persist security log', { error: error?.message }); return false; }
}

export async function enrichSecurityLog(db, id, record = {}) {
  try {
    const pool = getPool(db); if (!(await ensureSecurityTables(db)) || !pool || !id) return false;
    const result = await pool.query(`UPDATE ${TABLE_LOGS} SET event_type = COALESCE($2, event_type), severity = COALESCE($3, severity), executor_id = COALESCE($4, executor_id), executor_tag = COALESCE($5, executor_tag), audit_log_id = COALESCE($6, audit_log_id), reason = COALESCE($7, reason), metadata = COALESCE(metadata, '{}'::jsonb) || $8::jsonb WHERE id = $1`, [id, record.eventType || null, record.severity || null, record.executorId || null, record.executorTag || null, record.auditLogId || null, record.reason || null, JSON.stringify(record.metadata || {})]);
    if (result.rowCount > 0) {
      const source = await pool.query(`SELECT * FROM ${TABLE_LOGS} WHERE id = $1`, [id]);
      const row = source.rows[0];
      if (row) await pool.query(`UPDATE ${TABLE_OWNER_LOGS} SET guild_name = COALESCE($2, guild_name), incident_id = COALESCE($3, incident_id), event_type = $4, severity = $5, executor_id = COALESCE($6, executor_id), executor_tag = COALESCE($7, executor_tag), audit_log_id = COALESCE($8, audit_log_id), reason = COALESCE($9, reason), metadata = COALESCE(metadata, '{}'::jsonb) || $10::jsonb WHERE source_log_id = $1`, [id, record.guildName || record.metadata?.guildName || null, row.incident_id || record.incidentId || null, row.event_type, row.severity, row.executor_id, row.executor_tag, row.audit_log_id, row.reason, JSON.stringify(record.metadata || {})]);
    }
    return result.rowCount > 0;
  } catch (error) { logger.error('Failed to enrich security log', { error: error?.message, id }); return false; }
}

export async function persistAuditLogEntry(db, entry, guildId) {
  try {
    const pool = getPool(db); if (!(await ensureSecurityTables(db)) || !pool || !guildId || !entry) return false;
    const actionName = auditName(entry.action);
    const eventType = DEDUPE_EVENT[actionName] || `audit.${actionName}`;
    let existing = entry.id ? await pool.query(`SELECT id FROM ${TABLE_LOGS} WHERE audit_log_id = $1 ORDER BY id DESC LIMIT 1`, [entry.id]) : { rows: [] };
    if (!existing.rows[0] && DEDUPE_EVENT[actionName] && entry.targetId) existing = await pool.query(`SELECT id FROM ${TABLE_LOGS} WHERE guild_id = $1 AND target_id = $2 AND event_type = $3 AND created_at > CURRENT_TIMESTAMP - INTERVAL '8 seconds' ORDER BY id DESC LIMIT 1`, [guildId, entry.targetId, eventType]);
    const extra = entry.extra || {};
    const metadata = { targetName: entry.target?.name || entry.target?.tag || entry.target?.username || null, targetId: entry.target?.id || entry.targetId || null, targetType: entry.targetType || null, changes: entry.changes?.map((c) => ({ key: c.key, old: c.old ?? null, new: c.new ?? null })) || [], extra: extra ? JSON.parse(JSON.stringify(extra, (_key, value) => value?.id ? { id: value.id, name: value.name || null } : value)) : null, auditAction: actionName, auditActionId: entry.action, auditCreatedAt: entry.createdTimestamp || null, source: 'discord_audit_log' };
    const executor = entry.executor;
    if (existing.rows[0]?.id) { await enrichSecurityLog(db, existing.rows[0].id, { eventType, executorId: executor?.id || null, executorTag: executor?.tag || executor?.username || null, auditLogId: entry.id, reason: entry.reason || null, metadata }); return existing.rows[0].id; }
    return persistSecurityLog(db, { guildId, eventType, severity: 'warning', executorId: executor?.id || null, executorTag: executor?.tag || executor?.username || null, targetId: entry.target?.id || entry.targetId || null, targetType: entry.targetType || 'unknown', auditLogId: entry.id, reason: entry.reason || null, metadata });
  } catch (error) { logger.error('Failed to persist audit log entry', { error: error?.message }); return false; }
}

export async function createSecurityIncident(db, record = {}) {
  try {
    const pool = getPool(db); if (!(await ensureSecurityTables(db)) || !pool) return null;
    const incidentId = record.incidentId || makeIncidentId();
    await pool.query(`INSERT INTO ${TABLE_INCIDENTS} (incident_id, guild_id, executor_id, executor_tag, severity, trigger_type, action_taken, metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (incident_id) DO UPDATE SET metadata = ${TABLE_INCIDENTS}.metadata || EXCLUDED.metadata`, [incidentId, record.guildId, record.executorId || null, record.executorTag || null, record.severity || 'critical', record.triggerType || 'unknown', record.actionTaken || null, record.metadata || {}]);
    await mirrorOwnerIncident(pool, incidentId, record);
    return incidentId;
  } catch (error) { logger.error('Failed to persist security incident', { error: error?.message }); return null; }
}

export async function listSecurityLogs(db, guildId, limit = 100) { if (!(await ensureSecurityTables(db))) return []; const pool = getPool(db); if (!pool) return []; const result = await pool.query(`SELECT * FROM ${TABLE_LOGS} WHERE guild_id = $1 ORDER BY created_at DESC LIMIT $2`, [guildId, Math.min(Number(limit) || 100, 500)]); return result.rows; }
export async function listSecurityIncidents(db, guildId, limit = 50) { if (!(await ensureSecurityTables(db))) return []; const pool = getPool(db); if (!pool) return []; const result = await pool.query(`SELECT * FROM ${TABLE_INCIDENTS} WHERE guild_id = $1 ORDER BY created_at DESC LIMIT $2`, [guildId, Math.min(Number(limit) || 50, 200)]); return result.rows; }
export async function listOwnerSecurityLogs(db, limit = 500, guildId = null) { if (!(await ensureSecurityTables(db))) return []; const pool = getPool(db); if (!pool) return []; const safeLimit = Math.min(Number(limit) || 500, 1000); const result = guildId ? await pool.query(`SELECT * FROM ${TABLE_OWNER_LOGS} WHERE guild_id = $1 ORDER BY created_at DESC LIMIT $2`, [guildId, safeLimit]) : await pool.query(`SELECT * FROM ${TABLE_OWNER_LOGS} ORDER BY created_at DESC LIMIT $1`, [safeLimit]); return result.rows; }
export async function listOwnerSecurityIncidents(db, limit = 200, guildId = null) { if (!(await ensureSecurityTables(db))) return []; const pool = getPool(db); if (!pool) return []; const safeLimit = Math.min(Number(limit) || 200, 500); const result = guildId ? await pool.query(`SELECT * FROM ${TABLE_OWNER_INCIDENTS} WHERE guild_id = $1 ORDER BY created_at DESC LIMIT $2`, [guildId, safeLimit]) : await pool.query(`SELECT * FROM ${TABLE_OWNER_INCIDENTS} ORDER BY created_at DESC LIMIT $1`, [safeLimit]); return result.rows; }
export async function listOwnerSecurityGuilds(db) { if (!(await ensureSecurityTables(db))) return []; const pool = getPool(db); if (!pool) return []; const result = await pool.query(`SELECT guild_id, MAX(guild_name) AS guild_name, COUNT(*)::int AS log_count FROM ${TABLE_OWNER_LOGS} GROUP BY guild_id ORDER BY MAX(created_at) DESC`); return result.rows; }
