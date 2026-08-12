import { appShell, esc } from './layout.js';

function fmtDate(value) {
  try { return new Date(value).toLocaleString('es-ES'); } catch { return String(value); }
}

function meta(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function detailRows(data) {
  const entries = Object.entries(data || {}).filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0));
  if (!entries.length) return '<span class="small">Sin datos adicionales.</span>';
  return `<div style="display:grid;grid-template-columns:minmax(140px,220px) 1fr;gap:6px 14px">${entries.map(([k, v]) => {
    const value = typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
    return `<div class="small"><strong>${esc(k)}</strong></div><div><code style="white-space:pre-wrap;word-break:break-word">${esc(value)}</code></div>`;
  }).join('')}</div>`;
}

function logTarget(l) {
  const m = meta(l.metadata);
  if (m.name) return `#${m.name}`;
  if (m.tag) return m.tag;
  if (m.username) return m.username;
  return l.target_id || l.target_type || '—';
}

export function renderSecurity({ user, guild, incidents = [], logs = [] }) {
  const incidentRows = incidents.length ? incidents.map((i) => {
    const m = meta(i.metadata);
    return `<tr><td><code>${esc(i.incident_id)}</code></td><td>${esc(i.executor_tag || i.executor_id || 'Desconocido')}</td><td><span class="badge ${i.severity === 'critical' ? 'off' : 'on'}">${esc(i.severity)}</span></td><td>${esc(i.trigger_type)}</td><td>${esc(i.action_taken || 'Ninguna')}${m.hierarchyBlocked ? '<br><span class="small">Jerarquía de Discord impidió actuar</span>' : ''}</td><td>${fmtDate(i.created_at)}</td></tr>`;
  }).join('') : '<tr><td colspan="6">No hay incidentes registrados.</td></tr>';

  const logRows = logs.length ? logs.map((l) => {
    const m = meta(l.metadata);
    const target = logTarget(l);
    const summary = m.parentName ? `${target} · ${m.parentName}` : target;
    return `<tr>
      <td>${fmtDate(l.created_at)}</td>
      <td><strong>${esc(l.event_type)}</strong><br><span class="small">ID: ${esc(l.id)}</span></td>
      <td>${esc(l.executor_tag || l.executor_id || 'Desconocido')}<br><span class="small">${esc(l.executor_id || '')}</span></td>
      <td>${esc(summary)}<br><span class="small">${esc(l.target_id || '')}</span></td>
      <td><span class="badge ${l.severity === 'critical' ? 'off' : 'on'}">${esc(l.severity)}</span></td>
      <td>${esc(l.reason || '—')}</td>
    </tr>
    <tr><td colspan="6" style="padding-top:0"><details><summary>Ver detalles completos</summary><div style="padding:12px 0">${detailRows(m)}${l.audit_log_id ? `<div class="divider"></div><div class="small">Audit Log ID: <code>${esc(l.audit_log_id)}</code></div>` : ''}</div></details></td></tr>`;
  }).join('') : '<tr><td colspan="6">No hay logs persistentes.</td></tr>';

  const body = `<div class="page-head"><div class="eyebrow">Wolf Security</div><h1>${esc(guild.name)}</h1><p>Logs persistentes externos y eventos Anti-Nuke. Cada acción conserva IDs, nombres, jerarquía, permisos, categoría, ejecutor y metadatos disponibles.</p></div>
  <div class="card section"><div class="sec-head"><h2>🚨 Incidentes Anti-Nuke</h2><p>${incidents.length} incidentes recientes</p></div><div class="divider"></div><div style="overflow:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th>Incidente</th><th>Executor</th><th>Severidad</th><th>Trigger</th><th>Acción</th><th>Fecha</th></tr></thead><tbody>${incidentRows}</tbody></table></div></div>
  <div class="card section"><div class="sec-head"><h2>📋 Security Logs</h2><p>Últimos 100 eventos críticos y administrativos. Pulsa "Ver detalles completos" para inspeccionar toda la información disponible.</p></div><div class="divider"></div><div style="overflow:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th>Fecha</th><th>Evento</th><th>Executor</th><th>Objetivo</th><th>Severidad</th><th>Razón</th></tr></thead><tbody>${logRows}</tbody></table></div></div>`;
  return appShell({ title: `Security · ${guild.name}`, user, active: 'dashboard', body });
}
