import { appShell, esc } from './layout.js';

function fmtDate(value) {
  try { return new Date(value).toLocaleString('es-ES'); } catch { return String(value); }
}

export function renderSecurity({ user, guild, incidents = [], logs = [] }) {
  const incidentRows = incidents.length ? incidents.map((i) => `
    <tr><td><code>${esc(i.incident_id)}</code></td><td>${esc(i.executor_tag || i.executor_id || 'Desconocido')}</td>
    <td><span class="badge ${i.severity === 'critical' ? 'off' : 'on'}">${esc(i.severity)}</span></td>
    <td>${esc(i.trigger_type)}</td><td>${esc(i.action_taken || 'Ninguna')}</td><td>${fmtDate(i.created_at)}</td></tr>`).join('') :
    '<tr><td colspan="6">No hay incidentes registrados.</td></tr>';
  const logRows = logs.length ? logs.map((l) => `
    <tr><td>${fmtDate(l.created_at)}</td><td>${esc(l.event_type)}</td><td>${esc(l.executor_tag || l.executor_id || 'Desconocido')}</td>
    <td>${esc(l.target_type || '')}</td><td>${esc(l.severity)}</td><td>${esc(l.reason || '')}</td></tr>`).join('') :
    '<tr><td colspan="6">No hay logs persistentes.</td></tr>';
  const body = `<div class="page-head"><div class="eyebrow">Wolf Security</div><h1>${esc(guild.name)}</h1><p>Logs externos y eventos de Anti-Nuke. Estos registros no dependen del canal de logs de Discord.</p></div>
  <div class="card section"><div class="sec-head"><h2>🚨 Incidentes Anti-Nuke</h2><p>${incidents.length} incidentes recientes</p></div><div class="divider"></div>
  <div style="overflow:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th>Incidente</th><th>Executor</th><th>Severidad</th><th>Trigger</th><th>Acción</th><th>Fecha</th></tr></thead><tbody>${incidentRows}</tbody></table></div></div>
  <div class="card section"><div class="sec-head"><h2>📋 Security Logs</h2><p>Últimos 100 eventos críticos y administrativos.</p></div><div class="divider"></div>
  <div style="overflow:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th>Fecha</th><th>Evento</th><th>Executor</th><th>Objetivo</th><th>Severidad</th><th>Razón</th></tr></thead><tbody>${logRows}</tbody></table></div></div>`;
  return appShell({ title: `Security · ${guild.name}`, user, active: 'dashboard', body });
}
