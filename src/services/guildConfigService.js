const DEFAULT_CONFIG = {

  guild_id: null,

  // 🌎 LANGUAGE
  language: 'es',

  // 🔥 WELCOME
  welcome: {
    enabled: false,
    channel: null,
    message: '🎉 Bienvenido {user} a {server}'
  },

  // 📊 ADVANCED LOGS
  logs: {
    enabled: false,
    mode: 'single',
    channel: null,
    enabledEvents: {},
    categories: {
      message: null,
      member: null,
      moderation: null,
      voice: null,
      role: null,
      channel: null
    }
  },

  // 🛡️ PER-GUILD ANTI-NUKE
  antiNuke: {
    enabled: true,
    windowMs: 10000,
    incidentWindowMs: 30000,
    action: 'quarantine',
    thresholds: {
      channelDelete: 3,
      channelCreate: 5,
      channelUpdate: 5,
      roleCreate: 3,
      roleDelete: 3,
      roleUpdate: 3,
      ban: 3,
      kick: 3,
      webhook: 2,
    },
    protections: {
      channelDelete: true,
      channelCreate: true,
      channelUpdate: true,
      roleCreate: true,
      roleDelete: true,
      roleUpdate: true,
      ban: true,
      kick: true,
      webhook: true,
      dangerousPermissions: true,
    },
    safeRoleIds: [],
    protectedRoleIds: [],
    protectedUserIds: [],
  }

};

// ========================================
// 🔥 GET CONFIG
// ========================================

export async function getGuildConfig(db, guildId) {

  const key = `guild:${guildId}:config`;
  let config = await db.get(key, null);

  if (!config) {
    config = {
      ...DEFAULT_CONFIG,
      guild_id: guildId,
      antiNuke: JSON.parse(JSON.stringify(DEFAULT_CONFIG.antiNuke)),
    };
    await db.set(key, config);
  }

  let updated = false;

  if (!config.language) {
    config.language = 'es';
    updated = true;
  }

  if (!config.welcome) {
    config.welcome = {
      enabled: config.welcome_enabled || false,
      channel: config.welcome_channel || null,
      message: config.welcome_message || '🎉 Bienvenido {user} a {server}'
    };
    updated = true;
  }

  if (!config.logs) {
    config.logs = {
      enabled: config.logging_enabled || false,
      mode: 'single',
      channel: config.log_channel || null,
      categories: {
        message: null,
        member: null,
        moderation: null,
        voice: null,
        role: null,
        channel: null
      }
    };
    updated = true;
  }

  if (!config.logs.mode) {
    config.logs.mode = 'single';
    updated = true;
  }

  if (!config.logs.categories) {
    config.logs.categories = {
      message: null,
      member: null,
      moderation: null,
      voice: null,
      role: null,
      channel: null
    };
    updated = true;
  }

  if (!config.logs.enabledEvents || typeof config.logs.enabledEvents !== 'object') {
    config.logs.enabledEvents = {};
    updated = true;
  }

  if (!config.logs.channel) {
    const legacyChannel = config.logging?.channelId || config.logChannelId || null;
    if (legacyChannel) {
      config.logs.channel = legacyChannel;
      if (config.logging?.enabled === true || config.enableLogging === true) config.logs.enabled = true;
      updated = true;
    }
  }

  // 🛡️ Anti-Nuke migration: every guild gets its own complete policy.
  const d = DEFAULT_CONFIG.antiNuke;
  if (!config.antiNuke || typeof config.antiNuke !== 'object') {
    config.antiNuke = JSON.parse(JSON.stringify(d));
    updated = true;
  }
  if (typeof config.antiNuke.enabled !== 'boolean') { config.antiNuke.enabled = d.enabled; updated = true; }
  if (!Number.isFinite(Number(config.antiNuke.windowMs))) { config.antiNuke.windowMs = d.windowMs; updated = true; }
  if (!Number.isFinite(Number(config.antiNuke.incidentWindowMs))) { config.antiNuke.incidentWindowMs = d.incidentWindowMs; updated = true; }
  if (!['alert','quarantine','ban'].includes(config.antiNuke.action)) { config.antiNuke.action = d.action; updated = true; }
  config.antiNuke.thresholds = { ...d.thresholds, ...(config.antiNuke.thresholds || {}) };
  config.antiNuke.protections = { ...d.protections, ...(config.antiNuke.protections || {}) };
  config.antiNuke.safeRoleIds = Array.isArray(config.antiNuke.safeRoleIds) ? config.antiNuke.safeRoleIds : [];
  config.antiNuke.protectedRoleIds = Array.isArray(config.antiNuke.protectedRoleIds) ? config.antiNuke.protectedRoleIds : [];
  config.antiNuke.protectedUserIds = Array.isArray(config.antiNuke.protectedUserIds) ? config.antiNuke.protectedUserIds : [];

  if (updated) await db.set(key, config);
  return config;
}

export async function updateWelcome(db, guildId, value) {
  const config = await getGuildConfig(db, guildId);
  config.welcome.enabled = value;
  await db.set(`guild:${guildId}:config`, config);
  return config;
}

export async function updateWelcomeChannel(db, guildId, channelId) {
  const config = await getGuildConfig(db, guildId);
  config.welcome.channel = channelId;
  await db.set(`guild:${guildId}:config`, config);
  return config;
}

export async function updateWelcomeMessage(db, guildId, message) {
  const config = await getGuildConfig(db, guildId);
  config.welcome.message = message;
  await db.set(`guild:${guildId}:config`, config);
  return config;
}

export async function updateLogging(db, guildId, value) {
  const config = await getGuildConfig(db, guildId);
  config.logs.enabled = value;
  await db.set(`guild:${guildId}:config`, config);
  return config;
}

export async function updateLogChannel(db, guildId, channelId) {
  const config = await getGuildConfig(db, guildId);
  config.logs.channel = channelId;
  await db.set(`guild:${guildId}:config`, config);
  return config;
}

export async function updateLogMode(db, guildId, mode) {
  const config = await getGuildConfig(db, guildId);
  config.logs.mode = mode === 'advanced' || mode === 'Advanced Categories' ? 'advanced' : 'single';
  await db.set(`guild:${guildId}:config`, config);
  return config;
}

export async function updateLogCategory(db, guildId, category, channelId) {
  const config = await getGuildConfig(db, guildId);
  if (!config.logs.categories) config.logs.categories = {};
  config.logs.categories[category] = channelId;
  await db.set(`guild:${guildId}:config`, config);
  return config;
}

export async function updateLanguage(db, guildId, language) {
  const config = await getGuildConfig(db, guildId);
  config.language = language;
  await db.set(`guild:${guildId}:config`, config);
  return config;
}

export async function updateAntiNukeConfig(db, guildId, antiNuke) {
  const config = await getGuildConfig(db, guildId);
  config.antiNuke = {
    ...config.antiNuke,
    ...antiNuke,
    thresholds: { ...config.antiNuke.thresholds, ...(antiNuke.thresholds || {}) },
    protections: { ...config.antiNuke.protections, ...(antiNuke.protections || {}) },
  };
  await db.set(`guild:${guildId}:config`, config);
  return config;
}

export async function patchGuildConfig(db, guildId, patch = {}) {
  const config = await getGuildConfig(db, guildId);
  for (const [key, value] of Object.entries(patch)) {
    const isPlainObject = value && typeof value === 'object' && !Array.isArray(value);
    if (isPlainObject && config[key] && typeof config[key] === 'object') {
      config[key] = { ...config[key], ...value };
    } else {
      config[key] = value;
    }
  }
  await db.set(`guild:${guildId}:config`, config);
  return config;
}