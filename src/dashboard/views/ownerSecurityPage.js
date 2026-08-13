import { appShell, esc } from './layout.js';

function fmtDate(value) {
  try {
    return new Date(value).toLocaleString('es-MX', {
      dateStyle: 'short',
      timeStyle: 'medium',
    });
  } catch {
    return String(value || '—');
  }
}

function jsonDetails(metadata) {
  if (!metadata || typeof metadata !== 'object') return '';
  const json = esc(JSON.stringify(metadata, null, 2));
  return `<details class="vault-details"><summary>Ver detalles completos</summary><pre>${json}</pre></details>`;
}

function severityBadge(severity) {
  const critical = severity === 'critical';
  return `<span class="badge ${critical ? 'off' : 'on'}">${esc(severity || 'info')}</span>`;
}

function incidentCard(i) {
  return `<article class="vault-item">
    <div class="vault-item-head">
      <div>
        <div class="vault-event">🚨 ${esc(i.trigger_type || 'unknown')}</div>
        <div class="hint">${esc(fmtDate(i.created_at))}</div>
      </div>
      ${severityBadge(i.severity)}
    </div>
    <div class="vault-grid">
      <div><span class="vault-label">Servidor</span><b>${esc(i.guild_name || `Servidor ${i.guild_id}`)}</b><span class="hint mono">${esc(i.guild_id)}</span></div>
      <div><span class="vault-label">Incidente</span><span class="mono">${esc(i.incident_id)}</span></div>
      <div><span class="vault-label">Ejecutor</span><span>${esc(i.executor_tag || i.executor_id || 'Desconocido')}</span></div>
      <div><span class="vault-label">Acción</span><span>${esc(i.action_taken || '—')}</span></div>
    </div>
    ${jsonDetails(i.metadata)}
  </article>`;
}

function logCard(l) {
  return `<article class="vault-item">
    <div class="vault-item-head">
      <div>
        <div class="vault-event">${esc(l.event_type || 'unknown')}</div>
        <div class="hint">${esc(fmtDate(l.created_at))} · Log #${esc(l.id)}</div>
      </div>
      ${severityBadge(l.severity)}
    </div>
    <div class="vault-grid">
      <div><span class="vault-label">Servidor</span><b>${esc(l.guild_name || `Servidor ${l.guild_id}`)}</b><span class="hint mono">${esc(l.guild_id)}</span></div>
      <div><span class="vault-label">Ejecutor</span><span>${esc(l.executor_tag || l.executor_id || 'Desconocido')}</span></div>
      <div><span class="vault-label">Objetivo</span><span class="mono">${esc(l.target_id || '—')}</span></div>
      <div><span class="vault-label">Audit ID</span><span class="mono">${esc(l.audit_log_id || '—')}</span></div>
    </div>
    <div class="vault-reason"><span class="vault-label">Razón</span>${esc(l.reason || 'Sin razón registrada')}</div>
    ${jsonDetails(l.metadata)}
  </article>`;
}

function styles() {
  return `<style>
    .vault-stack{display:grid;gap:12px;margin-top:16px}
    .vault-item{background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:16px;min-width:0}
    .vault-item-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}
    .vault-event{font-weight:800;font-size:15px;overflow-wrap:anywhere}
    .vault-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
    .vault-grid>div{min-width:0;display:flex;flex-direction:column;gap:4px}
    .vault-label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#8f96aa;font-weight:700;margin-bottom:3px}
    .vault-grid b,.vault-grid span:not(.vault-label){overflow-wrap:anywhere;word-break:break-word}
    .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
    .vault-reason{margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.06);overflow-wrap:anywhere}
    .vault-details{margin-top:12px}
    .vault-details summary{cursor:pointer;color:#aeb5c8;font-size:12px;user-select:none}
    .vault-details pre{box-sizing:border-box;white-space:pre-wrap;overflow:auto;max-height:320px;margin:10px 0 0;padding:12px;border-radius:10px;background:#090b10;color:#cdd3e2;font-size:11px;line-height:1.5}
    .vault-empty{padding:28px;text-align:center;color:#8f96aa;border:1px dashed rgba(255,255,255,.1);border-radius:12px}
    @media(max-width:900px){.vault-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:560px){.vault-grid{grid-template-columns:1fr}.vault-item{padding:13px}}
  </style>`;
}

export function renderOwnerSecurity({ user, incidents, logs }) {
  const incidentContent = incidents.length
    ? incidents.map(incidentCard).join('')
    : `<div class="vault-empty">No hay incidentes Anti-Nuke archivados.</div>`;

  const logContent = logs.length
    ? logs.map(logCard).join('')
    : `<div class="vault-empty">No hay Security Logs archivados.</div>`;

  const body = `${styles()}
  <div class="page-head">
    <h1>🛡️ Security Vault</h1>
    <p>Archivo privado del dueño del bot. Los registros viven en PostgreSQL y no dependen de que el servidor siga existiendo en Discord.</p>
  </div>

  <div class="stat-grid">
    <div class="stat"><div class="label">Incidentes archivados</div><div class="value">${incidents.length}</div></div>
    <div class="stat"><div class="label">Logs archivados</div><div class="value">${logs.length}</div></div>
    <div class="stat"><div class="label">Protección</div><div class="value" style="font-size:18px">EXTERNA</div></div>
  </div>

  <div class="card">
    <div class="row" style="justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div><h2 style="margin:0">🚨 Incidentes Anti-Nuke</h2><p class="hint">Los incidentes permanecen aquí aunque Wolf salga o sea expulsado del servidor.</p></div>
      <a class="button" href="/admin">← Panel del dueño</a>
    </div>
    <div class="vault-stack">${incidentContent}</div>
  </div>

  <div class="card">
    <h2>📋 Archivo completo de Security Logs</h2>
    <p class="hint">Últimos ${logs.length} eventos archivados fuera del contexto del servidor.</p>
    <div class="vault-stack">${logContent}</div>
  </div>`;

  return appShell({ title: 'Security Vault', user, active: 'admin', body });
}
