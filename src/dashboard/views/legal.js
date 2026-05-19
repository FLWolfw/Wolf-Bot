import { basePage, esc, brandMark, BRAND, SUPPORT } from './layout.js';

function legalShell(title, intro, sections) {
  const today = new Date().toISOString().slice(0, 10);
  const blocks = sections
    .map(
      (s) => `<section class="legal-section">
      <h2>${esc(s.title)}</h2>
      ${s.body}
    </section>`,
    )
    .join('');

  return basePage({
    title,
    body: `<div class="landing">
  <div class="topbar">
    <a class="brand" href="/">${brandMark(34)}<span>${esc(BRAND)}</span></a>
    <div class="row">
      ${SUPPORT ? `<a class="btn btn-ghost" href="${esc(SUPPORT)}" target="_blank" rel="noopener">Soporte</a>` : ''}
      <a class="btn btn-ghost" href="/invite">Añadir a Discord</a>
      <a class="btn" href="/dashboard">Panel</a>
    </div>
  </div>

  <article class="legal">
    <div class="eyebrow">${esc(title)}</div>
    <h1 class="legal-title">${esc(title)}</h1>
    <p class="legal-updated">Última actualización: ${today}</p>
    <p class="legal-intro">${intro}</p>
    ${blocks}
    <p class="legal-foot">¿Dudas o solicitudes? ${
      SUPPORT
        ? `Únete a <a href="${esc(SUPPORT)}" target="_blank" rel="noopener">nuestro servidor de soporte</a>.`
        : 'Contacta al dueño del bot.'
    }</p>
  </article>
</div>`,
  });
}

export function renderTerms() {
  return legalShell(
    'Términos de Servicio',
    `Estos términos rigen el uso de <b>${esc(BRAND)}</b> ("el bot") y su panel web. Al añadir el bot a tu servidor de Discord o usar el panel, aceptas estos términos.`,
    [
      {
        title: '1. Uso del servicio',
        body: `<p>${esc(BRAND)} se ofrece "tal cual" para uso personal o de comunidad en servidores de Discord. Te comprometes a no usar el bot para acosar, distribuir contenido ilegal, evadir restricciones de Discord o realizar abuso (spam, ataques, automatización maliciosa).</p>`,
      },
      {
        title: '2. Acceso y aprobación',
        body: `<p>Para funcionar plenamente, un servidor debe ser aprobado por el dueño del bot. Hasta entonces los comandos quedan bloqueados. El dueño puede aprobar o revocar el acceso de cualquier servidor en cualquier momento y sin previo aviso si detecta abuso o incumplimiento.</p>`,
      },
      {
        title: '3. Permisos requeridos',
        body: `<p>El bot solicita los permisos necesarios para sus funciones (mensajes, gestión de canales/roles, etc.). Eres responsable de conceder solo los permisos que tu servidor necesite y de la configuración que apliques.</p>`,
      },
      {
        title: '4. Disponibilidad',
        body: `<p>No garantizamos disponibilidad ininterrumpida. El bot puede caerse, recibir mantenimiento o ser retirado de servicio en cualquier momento.</p>`,
      },
      {
        title: '5. Limitación de responsabilidad',
        body: `<p>No nos hacemos responsables de pérdidas o daños derivados del uso del bot, incluidos daños a la comunidad, configuraciones, datos del servidor o XP/economía in-bot.</p>`,
      },
      {
        title: '6. Cambios',
        body: `<p>Podemos modificar estos términos. Las versiones actualizadas se publican en esta página con la fecha de "última actualización".</p>`,
      },
    ],
  );
}

export function renderPrivacy() {
  return legalShell(
    'Política de Privacidad',
    `Esta política describe qué datos recopila <b>${esc(BRAND)}</b>, para qué se usan y cómo se gestionan.`,
    [
      {
        title: '1. Datos que recopilamos',
        body: `<ul>
          <li><b>IDs de Discord:</b> ID de servidor, ID de usuario, ID de canal y rol — necesarios para que los comandos funcionen.</li>
          <li><b>Configuración por servidor:</b> ajustes que estableces en el panel (canales de logs, bienvenida, niveles, etc.).</li>
          <li><b>Contenido funcional:</b> mensajes de logs (texto editado/borrado), notas de moderación, datos de economía/niveles, cumpleaños — solo si esas funciones están activas en tu servidor.</li>
          <li><b>Inicio de sesión web:</b> al iniciar sesión con Discord, recibimos tu ID, nombre, avatar y la lista de servidores donde tienes permisos relevantes. Se guardan en una sesión temporal del navegador.</li>
        </ul>`,
      },
      {
        title: '2. Para qué usamos los datos',
        body: `<p>Únicamente para prestar las funciones del bot en tu servidor (logs, moderación, economía, etc.) y para que puedas configurarlo desde la web. <b>No vendemos ni cedemos datos a terceros.</b></p>`,
      },
      {
        title: '3. Conservación',
        body: `<p>Los datos persisten mientras el bot esté en tu servidor. Si retiras el bot del servidor, la configuración asociada queda inactiva. Puedes solicitar el borrado completo de los datos de tu servidor escribiéndonos.</p>`,
      },
      {
        title: '4. Seguridad',
        body: `<p>Usamos prácticas estándar: HTTPS, cookies httpOnly, protección CSRF, y aislamiento por servidor. Solo los administradores reales de un servidor pueden editar su configuración desde la web.</p>`,
      },
      {
        title: '5. Cookies',
        body: `<p>Usamos una cookie de sesión propia (httpOnly, sameSite=lax) para mantener tu sesión iniciada. No usamos cookies de terceros ni rastreo publicitario.</p>`,
      },
      {
        title: '6. Tus derechos',
        body: `<p>Tienes derecho a saber qué datos guardamos sobre tu servidor, a corregirlos y a solicitar su borrado. Contáctanos por el canal de soporte.</p>`,
      },
    ],
  );
}
