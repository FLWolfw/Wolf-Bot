import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';

const TABLE_LOGS = 'security_logs';
const TABLE_INCIDENTS = 'security_incidents';
let schemaPromise = null;

function available(db) {
  return Boolean(db?.isAvailable?.() && db?.pool);
}

export function makeIncidentId() {
  return `INC-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function ensureSecurityTables(db) {
  if (!available(db)) return false;
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    await db.pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE_INCIDENTS} (
      incident_id VARCHAR(64) PRIMARY KEY,
      guild_id VARCHAR(20) NOT NULL,
      executor_id VARCHAR(20), executor_tag VARCHAR(200), severity VARCHAR(20) NOT NULL,
      trigger_type VARCHAR(80) NOT NULL, action_taken VARCHAR(80), metadata JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await db.pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE_LOGS} (
      id BIGSERIAL PRIMARY KEY,
      guild_id VARCHAR(20) NOT NULL, incident_id VARCHAR(64), event_type VARCHAR(100) NOT NULL,
      severity VARCHAR(20) NOT NULL, executor_id VARCHAR(20), executor_tag VARCHAR(200),
      target_id VARCHAR(30), target_type VARCHAR(50), audit_log_id VARCHAR(30), reason TEXT,
      metadata JSONB DEFAULT '{}', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await db.pool.query(`CREATE INDEX IF NOT EXISTS idx_security_logs_guild_created ON ${TABLE_LOGS}(guild_id, created_at DESC)`);
    await db.pool.query(`CREATE INDEX IF NOT EXISTS idx_security_logs_incident ON ${TABLE_LOGS}(incident_id)`);
    await db.pool.query(`CREATE INDEX IF NOT EXISTS idx_security_incidents_guild_created ON ${TABLE_INCIDENTS}(guild_id, created_at DESC)`);
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
    if (!(await ensureSecurityTables(db))) return false;
    await db.pool.query(`INSERT INTO ${TABLE_LOGS}
      (guild_id, incident_id, event_type, severity, executor_id, executor_tag, target_id, target_type, audit_log_id, reason, metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
      record.guildId, record.incidentId || null, record.eventType || 'unknown', record.severity || 'info',
      record.executorId || null, record.executorTag || null, record.targetId || null, record.targetType || null,
      record.auditLogId || null, record.reason || null, record.metadata || {},
    ]);
    return true;
  } catch (error) {
    logger.error('Failed to persist security log', { error: error?.message });
    return false;
  }
}

export async function createSecurityIncident(db, record = {}) {
  try {
    if (!(await ensureSecurityTables(db))) return null;
    const incidentId = record.incidentId || makeIncidentId();
    await db.pool.query(`INSERT INTO ${TABLE_INCIDENTS}
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
  const result = await db.pool.query(`SELECT * FROM ${TABLE_LOGS} WHERE guild_id = $1 ORDER BY created_at DESC LIMIT $2`, [guildId, Math.min(Number(limit) || 100, 500)]);
  return result.rows;
}

export async function listSecurityIncidents(db, guildId, limit = 50) {
  if (!(await ensureSecurityTables(db))) return [];
  const result = await db.pool.query(`SELECT * FROM ${TABLE_INCIDENTS} WHERE guild_id = $1 ORDER BY created_at DESC LIMIT $2`, [guildId, Math.min(Number(limit) || 50, 200)]);
  return result.rows;
}
