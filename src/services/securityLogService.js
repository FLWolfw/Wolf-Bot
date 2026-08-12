import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';

const TABLE_LOGS = 'security_logs';
const TABLE_INCIDENTS = 'security_incidents';
let schemaPromise = null;

function getPool(db) {
  return db?.pool || db?.db?.pool || null;
}

function available(db) {
  return Boolean(db?.isAvailable?.() && getPool(db));
}

export function makeIncidentId() {
  return `INC-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function ensureSecurityTables(db) {
  const pool = getPool(db);
  if (!available(db)) return false;
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE_INCIDENTS} (
      incident_id VARCHAR(64) PRIMARY KEY,
      guild_id VARCHAR(20) NOT NULL,
      executor_id VARCHAR(20), executor_tag VARCHAR(200), severity VARCHAR(20) NOT NULL,
      trigger_type VARCHAR(80) NOT NULL, action_taken VARCHAR(80), metadata JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    await pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE_LOGS} (
      id BIGSERIAL PRIMARY KEY,
      guild_id VARCHAR(20) NOT NULL, incident_id VARCHAR(64), event_type VARCHAR(100) NOT NULL,
      severity VARCHAR(20) NOT NULL, executor_id VARCHAR(20), executor_tag VARCHAR(200),
      target_id VARCHAR(30), target_type VARCHAR(50), audit_log_id VARCHAR(30), reason TEXT,
      metadata JSONB DEFAULT '{}', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_security_logs_guild_created ON ${TABLE_LOGS}(guild_id, created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_security_logs_incident ON ${TABLE_LOGS}(incident_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_security_incidents_guild_created ON ${TABLE_INCIDENTS}(guild_id, created_at DESC)`);
    return true;
  })().catch((error) => {
    schemaPromise = null;
    logger.error('Security tables initialization failed', { error: error?.message });
    return false;
  });

  return schemaPromise;
}

export async function persistSecurityLog(db, record = {}) {
  try {
    const pool = getPool(db);
    if (!(await ensureSecurityTables(db)) || !pool) return false;

    const result = await pool.query(`INSERT INTO ${TABLE_LOGS}
      (guild_id, incident_id, event_type, severity, executor_id, executor_tag, target_id, target_type, audit_log_id, reason, metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`, [
      record.guildId, record.incidentId || null, record.eventType || 'unknown', record.severity || 'info',
      record.executorId || null, record.executorTag || null, record.targetId || null, record.targetType || null,
      record.auditLogId || null, record.reason || null, record.metadata || {},
    ]);
    return result.rows[0]?.id || false;
  } catch (error) {
    logger.error('Failed to persist security log', { error: error?.message });
    return false;
  }
}

export async function enrichSecurityLog(db, id, record = {}) {
  try {
    const pool = getPool(db);
    if (!(await ensureSecurityTables(db)) || !pool || !id) return false;

    const metadata = record.metadata || {};
    const result = await pool.query(`UPDATE ${TABLE_LOGS}
      SET event_type = COALESCE($2, event_type), severity = COALESCE($3, severity),
          executor_id = COALESCE($4, executor_id), executor_tag = COALESCE($5, executor_tag),
          audit_log_id = COALESCE($6, audit_log_id), reason = COALESCE($7, reason),
          metadata = COALESCE(metadata, '{}'::jsonb) || $8::jsonb
      WHERE id = $1`, [
      id, record.eventType || null, record.severity || null, record.executorId || null,
      record.executorTag || null, record.auditLogId || null, record.reason || null, JSON.stringify(metadata),
    ]);
    return result.rowCount > 0;
  } catch (error) {
    logger.error('Failed to enrich security log', { error: error?.message, id });
    return false;
  }
}

export async function createSecurityIncident(db, record = {}) {
  try {
    const pool = getPool(db);
    if (!(await ensureSecurityTables(db)) || !pool) return null;

    const incidentId = record.incidentId || makeIncidentId();
    await pool.query(`INSERT INTO ${TABLE_INCIDENTS}
      (incident_id, guild_id, executor_id, executor_tag, severity, trigger_type, action_taken, metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (incident_id) DO UPDATE SET metadata = ${TABLE_INCIDENTS}.metadata || EXCLUDED.metadata`, [
      incidentId, record.guildId, record.executorId || null, record.executorTag || null,
      record.severity || 'critical', record.triggerType || 'unknown', record.actionTaken || null, record.metadata || {},
    ]);
    return incidentId;
  } catch (error) {
    logger.error('Failed to persist security incident', { error: error?.message });
    return null;
  }
}

export async function listSecurityLogs(db, guildId, limit = 100) {
  if (!(await ensureSecurityTables(db))) return [];
  const pool = getPool(db);
  if (!pool) return [];
  const result = await pool.query(`SELECT * FROM ${TABLE_LOGS} WHERE guild_id = $1 ORDER BY created_at DESC LIMIT $2`, [guildId, Math.min(Number(limit) || 100, 500)]);
  return result.rows;
}

export async function listSecurityIncidents(db, guildId, limit = 50) {
  if (!(await ensureSecurityTables(db))) return [];
  const pool = getPool(db);
  if (!pool) return [];
  const result = await pool.query(`SELECT * FROM ${TABLE_INCIDENTS} WHERE guild_id = $1 ORDER BY created_at DESC LIMIT $2`, [guildId, Math.min(Number(limit) || 50, 200)]);
  return result.rows;
}
