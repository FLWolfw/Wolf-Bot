import { appShell, esc } from './layout.js';

function fmtDate(value) {
  try { return new Date(value).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'medium' }); }
  catch { return String(value || '—'); }
}

function avatar(url, label = '') {
  return url ? `<img src="${esc(url)}" alt="" style="width:56px;height:56px;border-radius:50%;object-fit:cover" loading="lazy">` : `<div style="width:56px;height:56px;border-radius:50%;background:#252936;display:grid;place-items:center">👤</div>`;
}

function profileCard(profile) {
  const current = profile.current || {};
  const history = Array.isArray(profile.history) ? profile.history.slice().reverse() : [];
  const guilds = Object.values(profile.guilds || {});
  const historyHtml = history.length ? history.map((entry) => `<div class="identity-history-item">
    <div><b>${esc(fmtDate(entry.at))}</b><span class="hint"> · ${esc(entry.reason || 'observed')}</span></div>
    ${entry.guildName ? `<div class="hint">Servidor: ${esc(entry.guildName)} · <span class="mono">${esc(entry.guildId || '')}</span></div>` : ''}
    <div class="identity-changes">
      ${entry.changes?.length ? entry.changes.map((c) => `<div><b>${esc(c.type)}</b>: <span class="old">${esc(c.from || '—')}</span> → <span>${esc(c.to || '—')}</span></div>`).join('') : '<span class="hint">Snapshot registrado sin cambios.</span>'}
    </div>
    ${entry.avatar ? `<div class="identity-avatar-row">${avatar(entry.avatar)}<span class="hint">Avatar registrado en este momento</span></div>` : ''}
  </div>`).join('') : `<div class="vault-empty">Todavía no hay cambios históricos registrados.</div>`;

  return `<article class="identity-card">
    <div class="identity-head">
      ${avatar(current.avatar)}
      <div class="identity-main"><h2>${esc(current.globalName || current.username || profile.userId)}</h2><div class="mono">@${esc(current.username || 'unknown')} · ${esc(profile.userId)}</div><div class="hint">Primera detección: ${esc(fmtDate(profile.firstSeenAt))} · Última: ${esc(fmtDate(profile.lastSeenAt))}</div></div>
    </div>
    <div class="identity-stats"><span>${history.length} snapshots</span><span>${guilds.length} servidores</span></div>
    <div class="identity-grid">
      <div><span class="vault-label">Username actual</span><b>${esc(current.username || '—')}</b></div>
      <div><span class="vault-label">Display Name actual</span><b>${esc(current.globalName || '—')}</b></div>
      <div><span class="vault-label">Avatar</span><span>${current.avatar ? 'Guardado' : 'Sin avatar personalizado'}</span></div>
      <div><span class="vault-label">Servidores observados</span><span>${guilds.map((g) => `${esc(g.guildName || g.guildId)}`).join(', ') || '—'}</span></div>
    </div>
    <details class="vault-details"><summary>Ver historial completo</summary><div class="identity-history">${historyHtml}</div></details>
  </article>`;
}

function styles() {
  return `<style>
    .identity-toolbar{display:flex;justify-content:space-between;gap:14px;align-items:end;flex-wrap:wrap;margin-top:18px;padding:14px 16px;border:1px solid rgba(255,255,255,.07);border-radius:14px;background:rgba(255,255,255,.025)}
    .identity-search{display:flex;gap:8px;flex-wrap:wrap}.identity-search input{min-width:320px;background:#0b0d13;color:#e8ebf3;border:1px solid rgba(255,255,255,.12);border-radius:9px;padding:10px 12px;font:inherit}.identity-search button{padding:10px 14px}
    .identity-stack{display:grid;gap:12px;margin-top:16px}.identity-card{background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:18px}.identity-head{display:flex;gap:14px;align-items:center}.identity-main h2{margin:0 0 4px}.identity-stats{display:flex;gap:8px;margin:16px 0;color:#aeb5c8;font-size:12px}.identity-stats span{padding:5px 9px;border-radius:999px;background:rgba(255,255,255,.06)}
    .identity-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.identity-grid>div{display:flex;flex-direction:column;gap:4px;min-width:0}.identity-history{display:grid;gap:10px;margin-top:12px}.identity-history-item{padding:12px;border-radius:10px;background:#090b10;border:1px solid rgba(255,255,255,.06)}.identity-changes{margin-top:8px;display:grid;gap:4px}.identity-changes .old{text-decoration:line-through;opacity:.65}.identity-avatar-row{display:flex;align-items:center;gap:10px;margin-top:10px}.identity-avatar-row img{width:38px!important;height:38px!important}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}.vault-label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#8f96aa;font-weight:700}.hint{color:#8f96aa;font-size:12px}.vault-details{margin-top:14px}.vault-details summary{cursor:pointer;color:#aeb5c8;font-size:12px}.vault-empty{padding:24px;text-align:center;color:#8f96aa;border:1px dashed rgba(255,255,255,.1);border-radius:12px}
    @media(max-width:900px){.identity-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.identity-grid{grid-template-columns:1fr}.identity-search input{min-width:0;width:100%}}
  </style>`;
}

export function renderOwnerIdentity({ user, profiles, search = '' }) {
  const content = profiles.length ? profiles.map(profileCard).join('') : `<div class="vault-empty">No hay usuarios registrados${search ? ` para “${esc(search)}”` : ''}.</div>`;
  const body = `${styles()}
  <div class="page-head"><h1>👤 Historial de identidades</h1><p>Historial privado del dueño. Wolf conserva usernames, display names y avatares observados sin depender de que el usuario mantenga el mismo nombre.</p></div>
  <div class="identity-toolbar"><form class="identity-search" method="GET" action="/admin/identities"><input name="q" value="${esc(search)}" placeholder="Buscar ID, username, display name o servidor"><button>Buscar</button>${search ? '<a class="button" href="/admin/identities">Limpiar</a>' : ''}</form><a class="button" href="/admin/security">Security Vault →</a></div>
  <div class="identity-stack">${content}</div>`;
  return appShell({ title: 'Historial de identidades', user, active: 'admin', body });
}
