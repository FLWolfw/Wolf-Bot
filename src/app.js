import 'dotenv/config';
import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { REST } from '@discordjs/rest';
import express from 'express';
import cron from 'node-cron';

import config from './config/application.js';
import { initializeDatabase } from './utils/database.js';
import { getServerCounters, updateCounter } from './services/serverstatsService.js';
import { logger, startupLog, shutdownLog, printStartupBanner } from './utils/logger.js';
import { checkBirthdays } from './services/birthdayService.js';
import { checkGiveaways } from './services/giveawayService.js';
import { loadCommands, registerCommands as registerSlashCommands } from './handlers/commandLoader.js';
import { setupDashboard } from './dashboard/index.js';
import loadEvents from './handlers/events.js';
import { registerSecurityMonitor } from './events/securityMonitor.js';
import { initMusic } from './services/musicService.js';
import { handleSpotifyCallback } from './services/spotifyService.js';

class TitanBot extends Client {
  constructor() {
    super({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildBans, GatewayIntentBits.GuildEmojisAndStickers, GatewayIntentBits.GuildInvites, GatewayIntentBits.GuildWebhooks, GatewayIntentBits.GuildScheduledEvents], partials: ['USER'] });
    this.config = config;
    this.commands = new Collection();
    this.events = new Collection();
    this.buttons = new Collection();
    this.selectMenus = new Collection();
    this.modals = new Collection();
    this.cooldowns = new Collection();
    this.db = null;
    this.rest = new REST({ version: '10' }).setToken(config.bot.token);
  }

  async start() {
    try {
      startupLog('Initializing database...');
      const dbInstance = await initializeDatabase();
      this.db = dbInstance.db;
      const dbStatus = this.db.getStatus();
      startupLog(`Database ready — ${dbStatus.connectionType}`);
      this.startWebServer();
      startupLog('Loading commands...');
      await loadCommands(this);
      startupLog('Loading events...');
      await loadEvents(this);
      registerSecurityMonitor(this);
      startupLog('Logging into Discord...');
      await this.login(this.config.bot.token);
      startupLog('Initializing music player...');
      try { await initMusic(this); } catch (err) { logger.error('Music player init failed — /music will be unavailable', { error: err?.message }); }
      startupLog('Registering slash commands...');
      try { await this.registerCommands(); } catch (registerError) { logger.error('Slash command registration failed — continuing with previously registered commands', { error: registerError }); }
      printStartupBanner(this.user?.tag ?? 'Unknown', this.commands.size, dbStatus.connectionType);
      this.setupCronJobs();
    } catch (error) {
      logger.error('Fatal error during startup — bot will exit', { error });
      process.exit(1);
    }
  }

  startWebServer() {
    const app = express();
    setupDashboard(app, this);

    app.get('/spotify/callback', async (req, res) => {
      try {
        const { code, state, error } = req.query;
        if (error) return res.status(400).send(`<h2>Spotify authorization cancelled</h2><p>${String(error)}</p>`);
        if (!code || !state) return res.status(400).send('<h2>Invalid Spotify callback</h2>');
        const result = await handleSpotifyCallback(String(code), String(state));
        res.send(`<html><head><meta charset="utf-8"><title>Wolf Spotify</title></head><body style="font-family:Arial;text-align:center;padding:60px"><h1>✅ Spotify connected successfully</h1><p>Connected account: <b>${escapeHtml(result.profile.display_name || result.profile.id)}</b></p><p>You can close this window and return to Discord.</p></body></html>`);
      } catch (err) {
        logger.error('Spotify OAuth callback failed', { error: err?.message });
        res.status(400).send(`<h2>Spotify connection failed</h2><p>${escapeHtml(err?.message || 'Unknown error')}</p>`);
      }
    });

    app.get('/healthz', (req, res) => res.json({ status: 'online', bot: 'Wolf' }));
    app.use((req, res) => res.status(404).json({ error: `Route not found: ${req.url}` }));
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, '0.0.0.0', () => startupLog(`Web server listening on port ${PORT}`));
  }

  setupCronJobs() {
    cron.schedule('0 6 * * *', () => checkBirthdays(this));
    cron.schedule('* * * * *', () => checkGiveaways(this));
    cron.schedule('*/15 * * * *', async () => { try { await this.updateAllCounters(); } catch (err) { logger.error('Cron error — updateAllCounters failed', { error: err }); } });
    logger.debug('Cron jobs scheduled (birthdays, giveaways, counters)');
  }

  async updateAllCounters() { for (const guild of this.guilds.cache.values()) { const counters = await getServerCounters(this, guild.id); for (const counter of counters) await updateCounter(this, guild, counter); } }
  async registerCommands() { await registerSlashCommands(this, this.config.bot.guildId); }
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]); }
process.on('SIGTERM', () => { shutdownLog('Received SIGTERM — shutting down gracefully'); process.exit(0); });
process.on('SIGINT', () => { shutdownLog('Received SIGINT — shutting down gracefully'); process.exit(0); });
const bot = new TitanBot();
bot.start();
