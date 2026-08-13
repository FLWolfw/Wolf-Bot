import express from 'express';
import { logger } from '../../utils/logger.js';
import { getGuildConfig } from '../../services/guildConfigService.js';
import { ensureCsrfToken } from '../lib/csrf.js';
import { manageableGuilds } from '../lib/oauth.js';
import { requireLogin, makeRequireGuildAdmin, requireOwner } from '../middleware/auth.js';
import { listAccess } from '../../services/accessService.js';
import { listSecurityIncidents, listSecurityLogs, listOwnerSecurityIncidents, listOwnerSecurityLogs, listOwnerSecurityGuilds } from '../../services/securityLogService.js';
import { renderLanding } from '../views/landing.js';
import { renderDashboard } from '../views/dashboardPage.js';
import { renderServer } from '../views/serverPage.js';
import { renderOwner } from '../views/ownerPage.js';
import { renderOwnerSecurity } from '../views/ownerSecurityPage.js';
import { renderTerms, renderPrivacy } from '../views/legal.js';
import { renderCommands } from '../views/commandsPage.js';
import { renderSecurity } from '../views/securityPage.js';

function takeFlash(req) {
  const flash = req.session?.flash || null;
  if (req.session) delete req.session.flash;
  return flash;
}

export function pageRoutes(client) {
  const router = express.Router();
  const requireGuildAdmin = makeRequireGuildAdmin(client);

  router.get('/', (req, res) => { res.send(renderLanding({ loggedIn: Boolean(req.session.user) })); });
  router.get('/terms', (req, res) => { res.send(renderTerms()); });
  router.get('/privacy', (req, res) => { res.send(renderPrivacy()); });
  router.get('/commands', (req, res) => { res.send(renderCommands({ client })); });

  router.get('/dashboard', requireLogin, (req, res) => {
    const guilds = manageableGuilds(req.session.guilds, client);
    res.send(renderDashboard({ user: req.session.user, client, guilds, flash: takeFlash(req) }));
  });

  router.get('/admin', requireLogin, requireOwner, async (req, res) => {
    try {
      const access = await listAccess(client.db);
      const approved = new Set(access.map((a) => a.guildId));
      res.send(renderOwner({ user: req.session.user, client, approved, csrf: ensureCsrfToken(req), flash: takeFlash(req) }));
    } catch (err) {
      logger.error('Owner panel failed', { error: err?.message });
      res.status(500).send('Error cargando el panel del dueño.');
    }
  });

  router.get('/admin/security', requireLogin, requireOwner, async (req, res) => {
    try {
      const requestedGuildId = String(req.query.guild || '').trim();
      const guildId = /^[0-9]{5,25}$/.test(requestedGuildId) ? requestedGuildId : null;
      const [incidents, logs, guilds] = await Promise.all([
        listOwnerSecurityIncidents(client.db, 200, guildId),
        listOwnerSecurityLogs(client.db, 500, guildId),
        listOwnerSecurityGuilds(client.db),
      ]);
      const currentGuildNames = new Map(client.guilds.cache.map((g) => [g.id, g.name]));
      const serverOptions = guilds.map((g) => ({ guildId: g.guild_id, guildName: currentGuildNames.get(g.guild_id) || g.guild_name || `Servidor ${g.guild_id}`, logCount: g.log_count }));
      for (const g of client.guilds.cache.values()) {
        if (!serverOptions.some((item) => item.guildId === g.id)) serverOptions.push({ guildId: g.id, guildName: g.name, logCount: 0 });
      }
      serverOptions.sort((a, b) => a.guildName.localeCompare(b.guildName, 'es'));
      res.send(renderOwnerSecurity({ user: req.session.user, incidents, logs, serverOptions, selectedGuildId: guildId }));
    } catch (err) {
      logger.error('Owner Security Vault failed', { error: err?.message });
      res.status(500).send('Error cargando el Security Vault.');
    }
  });

  router.get('/server/:id/security', requireGuildAdmin, async (req, res) => {
    try {
      const incidents = await listSecurityIncidents(client.db, req.guild.id, 50);
      const logs = await listSecurityLogs(client.db, req.guild.id, 100);
      res.send(renderSecurity({ user: req.session.user, guild: req.guild, incidents, logs }));
    } catch (err) {
      logger.error('Security page failed', { error: err?.message });
      res.status(500).send('Error cargando Security.');
    }
  });

  router.get('/server/:id', requireGuildAdmin, async (req, res) => {
    try {
      const config = await getGuildConfig(client.db, req.guild.id);
      res.send(renderServer({ user: req.session.user, guild: req.guild, config, csrf: ensureCsrfToken(req), flash: takeFlash(req) }));
    } catch (err) {
      logger.error('Dashboard server page failed', { error: err?.message });
      res.status(500).send('Error cargando la configuración del servidor.');
    }
  });

  return router;
}
