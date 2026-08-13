import { appShell, esc } from './layout.js';

function fmtDate(value) {
  try { return new Date(value).toLocaleString('es-ES'); } catch { return String(value || '—'); }
}

function details(metadata) {
  if (!metadata || typeof metadata !== 'object') return '';
  const json = esc(JSON.stringify(metadata, null, 2));
  return `<details><summary>Ver detalles completos</summary><pre style="white-space:pre-wrap;max-height:360px;overflow:auto;margin:10px 0 0">${json}</pre></details>`;
}

export function renderOwnerSecurity({ user, incidents, logs, guildFilter = '' }) {
  const incidentRows = incidents.length
    ? incidents.map((i) => `<tr>
        <td>${esc(fmtDate(i.created_at))}</td>
        <td><b>${esc(i.guild_name || `Servidor ${i.guild_id}`)}</b><br><span class="hint">${esc(i.guild_id)}</span></td>
        <td>${esc(i.incident_id)}</td>
        <td>${esc(i.executor_tag || i.executor_id || 'Desconocido')}</td>
        <td><span class="badge off">${esc(i.severity)}</span></td>
        <td>${esc(i.trigger_type)}</td>
        <td>${esc(i.action_taken || '—')}</td>
      </tr>`).join('')
    : `<tr><td colspan="7">No hay incidentes archivados.</td></tr>`;

  const logRows = logs.length
    ? logs.map((l) => `<tr>
        <td>${esc(fmtDate(l.created_at))}</td>
        <td><b>${esc(l.guild_name || `Servidor ${l.guild_id}`)}</b><br><span class="hint">${esc(l.guild_id)}</span></td>
        <td><b>${esc(l.event_type)}</b><br><span class="hint">ID ${esc(l.id)}</span></td>
        <td>${esc(l.executor_tag || l.executor_id || 'Desconocido')}</td>
        <td>${esc(l.target_id || '—')}</td>
        <td><span class="badge ${l.severity === 'critical' ? 'off' : 'on'}">${esc(l.severity)}</span></td>
        <td>${esc(l.reason || '—')}${details(l.metadata)}</td>
      </tr>`).join('')
    : `<tr><td colspan="7">No hay logs archivados.</td></tr>`;

  const body = `<div class="page-head">
    <h1>🛡️ Security Vault</h1>
    <p>Archivo privado del dueño del bot. Estos registros viven en PostgreSQL y no dependen de que el servidor siga existiendo en Discord.</p>
  </div>

  <div class="stat-grid">
    <div class="stat"><div class="label">Incidentes archivados</div><div class="value">${incidents.length}</div></div>
    <div class="stat"><div class="label">Logs archivados</div><div class="value">${logs.length}</div></div>
    <div class="stat"><div class="label">Protección</div><div class="value" style="font-size:18px">EXTERNA</div></div>
  </div>

  <div class="card">
    <div class="row" style="justify-content:space-between;align-items:center;gap:12px">
      <div><h2 style="margin:0">🚨 Incidentes Anti-Nuke</h2><p class="hint">Los incidentes permanecen aquí aunque Wolf salga o sea expulsado del servidor.</p></div>
      <a class="button" href="/admin">← Panel del dueño</a>
    </div>
    <div style="overflow:auto;margin-top:16px"><table><thead><tr><th>Fecha</th><th>Servidor</th><th>Incidente</th><th>Ejecutor</th><th>Severidad</th><th>Trigger</th><th>Acción</th></tr></thead><tbody>${incidentRows}</tbody></table></div>
  </div>

  <div class="card">
    <h2>📋 Archivo completo de Security Logs</h2>
    <p class="hint">Últimos ${logs.length} eventos críticos y administrativos archivados fuera del contexto del servidor.</p>
    <div style="overflow:auto;margin-top:16px"><table><thead><tr><th>Fecha</th><th>Servidor</th><th>Evento</th><th>Ejecutor</th><th>Objetivo</th><th>Severidad</th><th>Razón / detalles</th></tr></thead><tbody>${logRows}</tbody></table></div>
  </div>`;

  return appShell({ title: 'Security Vault', user, active: 'admin', body });
}
