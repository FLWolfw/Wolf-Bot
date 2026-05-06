import session from 'express-session';
import axios from 'axios';
import express from 'express';
import path from 'path';

import {
  fileURLToPath
} from 'url';

const __filename =
  fileURLToPath(import.meta.url);

const __dirname =
  path.dirname(__filename);

export function setupDashboard(app, client) {

  console.log('🔥 Dashboard cargado');

  app.use(express.urlencoded({
    extended: true
  }));

  // =====================================
  // 🎨 STATIC FILES
  // =====================================

  app.use(

    '/assets',

    express.static(

      path.join(
        __dirname,
        'public'
      )

    )

  );

  // =====================================
  // 🔐 SESSION
  // =====================================

  app.use(session({

    secret:
      process.env.SESSION_SECRET ||
      'wk-secret',

    resave: false,

    saveUninitialized: false

  }));

  // =====================================
  // 🔐 LOGIN
  // =====================================

  app.get('/login', (req, res) => {

    const url =

      `https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify%20guilds`;

    res.redirect(url);

  });

  // =====================================
  // 🔐 CALLBACK
  // =====================================

  app.get('/callback', async (req, res) => {

    const code =
      req.query.code;

    try {

      const tokenRes =

        await axios.post(

          'https://discord.com/api/oauth2/token',

          new URLSearchParams({

            client_id:
              process.env.CLIENT_ID,

            client_secret:
              process.env.CLIENT_SECRET,

            grant_type:
              'authorization_code',

            code,

            redirect_uri:
              process.env.REDIRECT_URI

          }),

          {

            headers: {

              'Content-Type':
                'application/x-www-form-urlencoded'

            }
          }
        );

      const accessToken =
        tokenRes.data.access_token;

      const userRes =

        await axios.get(
          'https://discord.com/api/users/@me',
          {

            headers: {

              Authorization:
                `Bearer ${accessToken}`

            }
          }
        );

      const guildsRes =

        await axios.get(
          'https://discord.com/api/users/@me/guilds',
          {

            headers: {

              Authorization:
                `Bearer ${accessToken}`

            }
          }
        );

      req.session.user =
        userRes.data;

      req.session.guilds =
        guildsRes.data;

      res.redirect('/dashboard');

    } catch (err) {

      console.error(err);

      res.send(
        '❌ Error en login'
      );

    }
  });

  // =====================================
  // 🧠 DASHBOARD
  // =====================================

  app.get('/dashboard', (req, res) => {

    if (!req.session.user) {

      return res.redirect(
        '/login'
      );

    }

    const user =
      req.session.user;

    const guilds =
      req.session.guilds || [];

    const adminGuilds =

      guilds.filter(
        g =>
          (g.permissions & 0x8) === 0x8
      );

    const botGuildIds =

      client.guilds.cache.map(
        g => g.id
      );

    const filteredGuilds =

      adminGuilds.filter(
        g =>
          botGuildIds.includes(
            g.id
          )
      );

    res.send(`

      <html>

        <head>

          <link
            rel="stylesheet"
            href="/assets/style.css"
          >

        </head>

        <body>

          <div class="sidebar">

            <h1>
              WK'
            </h1>

            <a href="/dashboard">
              🏠 Dashboard
            </a>

            <a href="/logout">
              🚪 Logout
            </a>

          </div>

          <div class="main">

            <div class="stats-grid">

              <div class="stat-card">

                <h3>
                  🌎 Servers
                </h3>

                <p>
                  ${client.guilds.cache.size}
                </p>

              </div>

              <div class="stat-card">

                <h3>
                  👥 Users
                </h3>

                <p>
                  ${client.guilds.cache.reduce((a, g) => a + g.memberCount, 0)}
                </p>

              </div>

              <div class="stat-card">

                <h3>
                  ⚡ Ping
                </h3>

                <p>
                  ${client.ws.ping}ms
                </p>

              </div>

              <div class="stat-card">

                <h3>
                  🤖 Commands
                </h3>

                <p>
                  ${client.commands.size}
                </p>

              </div>

            </div>

            <div class="card">

              <img
                src="https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png"
                width="90"
                style="
                  border-radius:50%;
                "
              >

              <h2>
                ${user.username}
              </h2>

            </div>

            <div class="card">

              <h2>
                🌎 Servidores
              </h2>

              ${filteredGuilds.map(g => `

                <div
                  style="
                    margin-top:15px;
                  "
                >

                  <a
                    href="/server/${g.id}"

                    style="
                      color:#00ffcc;
                      font-size:18px;
                      text-decoration:none;
                    "
                  >

                    ${g.name}

                  </a>

                </div>

              `).join('')}

            </div>

          </div>

        </body>

      </html>

    `);

  });

  // =====================================
  // 🧠 SERVER PANEL
  // =====================================

  app.get('/server/:id', async (req, res) => {

    if (!req.session.user) {

      return res.redirect(
        '/login'
      );

    }

    const serverId =
      req.params.id;

    const {

      getGuildConfig

    } =

      await import(
        '../services/guildConfigService.js'
      );

    const config =

      await getGuildConfig(
        client.db,
        serverId
      );

    const guild =

      client.guilds.cache.get(
        serverId
      );

    const channels =

      guild.channels.cache

        .filter(
          c => c.type === 0
        )

        .map(c => `

          <option value="${c.id}">

            #${c.name}

          </option>

        `)

        .join('');

    res.send(`

      <html>

        <head>

          <link
            rel="stylesheet"
            href="/assets/style.css"
          >

        </head>

        <body>

          <div class="sidebar">

            <h1>
              WK'
            </h1>

            <a href="/dashboard">
              🏠 Dashboard
            </a>

            <a href="/logout">
              🚪 Logout
            </a>

          </div>

          <div class="main">

            <div class="card">

              <h1>
                ${guild.name}
              </h1>

            </div>

            <div class="card">

              <h2>
                🌎 Language
              </h2>

              <p>
                Current:
                <b>
                  ${config.language}
                </b>
              </p>

              <form
                method="POST"
                action="/server/${serverId}/language"
              >

                <select name="language">

                  <option
                    value="es"

                    ${
                      config.language === 'es'
                        ? 'selected'
                        : ''
                    }
                  >

                    Español

                  </option>

                  <option
                    value="en"

                    ${
                      config.language === 'en'
                        ? 'selected'
                        : ''
                    }
                  >

                    English

                  </option>

                </select>

                <button>
                  Save
                </button>

              </form>

            </div>

            <div class="card">

              <h2>
                👋 Welcome
              </h2>

              <p>

                ${
                  config.welcome?.enabled

                    ? '🟢 Enabled'

                    : '🔴 Disabled'
                }

              </p>

              <form
                method="POST"
                action="/server/${serverId}/welcome"
              >

                <button>

                  ${
                    config.welcome?.enabled

                      ? 'Disable'

                      : 'Enable'
                  }

                </button>

              </form>

              <br>

              <form
                method="POST"
                action="/server/${serverId}/channel"
              >

                <select name="channel">

                  ${channels}

                </select>

                <button>
                  Save Channel
                </button>

              </form>

              <br>

              <form
                method="POST"
                action="/server/${serverId}/message"
              >

                <input
                  type="text"
                  name="message"

                  value="${
                    config.welcome?.message || ''
                  }"

                  style="
                    width:300px;
                  "
                >

                <button>
                  Save Message
                </button>

              </form>

            </div>

            <div class="card">

              <h2>
                📊 Logs
              </h2>

              <p>

                ${
                  config.logs?.enabled

                    ? '🟢 Enabled'

                    : '🔴 Disabled'
                }

              </p>

              <form
                method="POST"
                action="/server/${serverId}/logs/toggle"
              >

                <button>

                  ${
                    config.logs?.enabled

                      ? 'Disable Logs'

                      : 'Enable Logs'
                  }

                </button>

              </form>

              <br>

              <form
                method="POST"
                action="/server/${serverId}/logs/channel"
              >

                <select name="channel">

                  ${channels}

                </select>

                <button>
                  Save Channel
                </button>

              </form>

            </div>

          </div>

        </body>

      </html>

    `);

  });

  // =====================================
  // 🌎 LANGUAGE
  // =====================================

  app.post('/server/:id/language', async (req, res) => {

    const serverId =
      req.params.id;

    const {

      updateLanguage

    } =

      await import(
        '../services/guildConfigService.js'
      );

    await updateLanguage(

      client.db,

      serverId,

      req.body.language

    );

    res.redirect(
      `/server/${serverId}`
    );

  });

  // =====================================
  // 👋 WELCOME
  // =====================================

  app.post('/server/:id/welcome', async (req, res) => {

    const serverId =
      req.params.id;

    const {

      getGuildConfig,
      updateWelcome

    } =

      await import(
        '../services/guildConfigService.js'
      );

    const config =

      await getGuildConfig(
        client.db,
        serverId
      );

    await updateWelcome(

      client.db,

      serverId,

      !config.welcome?.enabled

    );

    res.redirect(
      `/server/${serverId}`
    );

  });

  app.post('/server/:id/channel', async (req, res) => {

    const serverId =
      req.params.id;

    const {

      updateWelcomeChannel

    } =

      await import(
        '../services/guildConfigService.js'
      );

    await updateWelcomeChannel(

      client.db,

      serverId,

      req.body.channel

    );

    res.redirect(
      `/server/${serverId}`
    );

  });

  app.post('/server/:id/message', async (req, res) => {

    const serverId =
      req.params.id;

    const {

      updateWelcomeMessage

    } =

      await import(
        '../services/guildConfigService.js'
      );

    await updateWelcomeMessage(

      client.db,

      serverId,

      req.body.message

    );

    res.redirect(
      `/server/${serverId}`
    );

  });

  // =====================================
  // 📊 LOGS
  // =====================================

  app.post('/server/:id/logs/toggle', async (req, res) => {

    const serverId =
      req.params.id;

    const {

      getGuildConfig,
      updateLogging

    } =

      await import(
        '../services/guildConfigService.js'
      );

    const config =

      await getGuildConfig(
        client.db,
        serverId
      );

    await updateLogging(

      client.db,

      serverId,

      !config.logs?.enabled

    );

    res.redirect(
      `/server/${serverId}`
    );

  });

  app.post('/server/:id/logs/channel', async (req, res) => {

    const serverId =
      req.params.id;

    const {

      updateLogChannel

    } =

      await import(
        '../services/guildConfigService.js'
      );

    await updateLogChannel(

      client.db,

      serverId,

      req.body.channel

    );

    res.redirect(
      `/server/${serverId}`
    );

  });

  // =====================================
  // 🚪 LOGOUT
  // =====================================

  app.get('/logout', (req, res) => {

    req.session.destroy(() =>

      res.redirect('/')

    );

  });
}