import { Events, AuditLogEvent } from 'discord.js';
import { getGuildConfig } from '../../services/guildConfigService.js';
import { createLogEmbed } from '../../utils/logEmbed.js';

export default {
  name: Events.VoiceStateUpdate,

  async execute(oldState, newState, client) {

    const guild = newState.guild;
    if (!guild) return;

    const member = newState.member;
    if (!member || member.user.bot) return;

    const config = await getGuildConfig(client.db, guild.id);

    if (!config.logs?.enabled) return;

    let logChannel = null;

    // 🔥 CATEGORY
    if (config.logs?.categories?.voice) {
      logChannel =
        guild.channels.cache.get(config.logs.categories.voice)
        || await guild.channels
          .fetch(config.logs.categories.voice)
          .catch(() => null);
    }

    // 🔥 FALLBACK
    if (!logChannel && config.logs?.channel) {
      logChannel =
        guild.channels.cache.get(config.logs.channel)
        || await guild.channels
          .fetch(config.logs.channel)
          .catch(() => null);
    }

    if (!logChannel) return;

    let title = null;
    let description = null;
    let color = '#00ffae';

    // 🔊 JOIN
    if (!oldState.channel && newState.channel) {

      title = '🔊 Voice Join';
      color = '#00ffae';

      description =
        `📥 Se unió a ${newState.channel}`;

    }

    // 🔇 LEAVE / DISCONNECT
    else if (oldState.channel && !newState.channel) {

      let disconnector = 'Usuario (auto-salida)';

      try {

        await new Promise(r => setTimeout(r, 1200));

        const logs = await guild.fetchAuditLogs({
          limit: 10,
          type: AuditLogEvent.MemberDisconnect
        });

        const now = Date.now();

        const entry = logs.entries.find(e =>
          e.target?.id === member.id &&
          (now - e.createdTimestamp) < 7000
        );

        if (entry) {
          disconnector =
            `${entry.executor.tag} (${entry.executor.id})`;
        }

      } catch {}

      title = '🔇 Voice Leave';
      color = '#ff4d4d';

      description =
        `📤 Salió de ${oldState.channel}\n\n` +
        `🧑‍💼 Desconectado por:\n${disconnector}`;

    }

    // 🔁 MOVE
    else if (
      oldState.channel &&
      newState.channel &&
      oldState.channel.id !== newState.channel.id
    ) {

      let mover = 'Desconocido';

      try {

        await new Promise(r => setTimeout(r, 1200));

        const logs = await guild.fetchAuditLogs({
          limit: 10,
          type: AuditLogEvent.MemberMove
        });

        const now = Date.now();

        const entry = logs.entries.find(e =>
          e.target?.id === member.id &&
          (now - e.createdTimestamp) < 7000
        );

        if (entry) {
          mover =
            `${entry.executor.tag} (${entry.executor.id})`;
        }

      } catch {}

      title = '🔁 Voice Move';
      color = '#ffaa00';

      description =
        `📂 Canal anterior:\n${oldState.channel}\n\n` +
        `📂 Canal nuevo:\n${newState.channel}\n\n` +
        `🧑‍💼 Movido por:\n${mover}`;

    }

    // 🔇 SERVER MUTE
    else if (
      oldState.serverMute !== newState.serverMute
    ) {

      title = newState.serverMute
        ? '🔇 Server Muted'
        : '🔊 Server Unmuted';

      color = '#ff8800';

      description = newState.serverMute
        ? 'Un moderador silenció al usuario.'
        : 'El usuario fue desmuteado por un moderador.';

    }

    // 🔕 SERVER DEAF
    else if (
      oldState.serverDeaf !== newState.serverDeaf
    ) {

      title = newState.serverDeaf
        ? '🔕 Server Deafened'
        : '🔊 Server Undeafened';

      color = '#bb55ff';

      description = newState.serverDeaf
        ? 'Un moderador ensordeció al usuario.'
        : 'El usuario ya puede escuchar nuevamente.';

    }

    // 🎤 SELF MUTE
    else if (
      oldState.selfMute !== newState.selfMute
    ) {

      title = newState.selfMute
        ? '🎤 Usuario se muteó'
        : '🎤 Usuario se desmuteó';

      color = '#00c3ff';

      description = newState.selfMute
        ? 'El usuario se silenció.'
        : 'El usuario volvió a hablar.';

    }

    // 🎧 SELF DEAF
    else if (
      oldState.selfDeaf !== newState.selfDeaf
    ) {

      title = newState.selfDeaf
        ? '🎧 Usuario se ensordeció'
        : '🎧 Usuario activó audio';

      color = '#9d4edd';

      description = newState.selfDeaf
        ? 'El usuario se desactivó el audio.'
        : 'El usuario volvió a escuchar.';

    }

    // 📺 STREAM
    else if (
      oldState.streaming !== newState.streaming
    ) {

      title = newState.streaming
        ? '📺 Stream iniciado'
        : '📺 Stream finalizado';

      color = '#ff0055';

      description = newState.streaming
        ? 'El usuario comenzó a transmitir.'
        : 'El usuario dejó de transmitir.';

    }

    // 📷 CAMERA
    else if (
      oldState.selfVideo !== newState.selfVideo
    ) {

      title = newState.selfVideo
        ? '📷 Cámara activada'
        : '📷 Cámara desactivada';

      color = '#00ffaa';

      description = newState.selfVideo
        ? 'El usuario encendió su cámara.'
        : 'El usuario apagó su cámara.';

    }

    if (!title) return;

    const embed = createLogEmbed({
      title,
      color,
      user: member.user,
      fields: [
        {
          name: '👤 Usuario',
          value:
            `${member.user}\n` +
            `🆔 \`${member.id}\``,
          inline: true
        },
        {
          name: '🎙️ Estado Voice',
          value: description,
          inline: false
        }
      ],
      footer: `Servidor: ${guild.name}`
    });

    await logChannel.send({
      embeds: [embed]
    });

  }
};