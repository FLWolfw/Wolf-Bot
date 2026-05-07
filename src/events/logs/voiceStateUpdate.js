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

    let action = null;
    let description = '';
    let color = '#00ffae';

    // 🔊 JOIN
    if (!oldState.channel && newState.channel) {
      action = '🔊 Se unió a un canal';
      description = `Se unió a ${newState.channel}`;
      color = '#00ffae';
    }

    // 🔇 LEAVE
    else if (oldState.channel && !newState.channel) {
      action = '🔇 Salió del canal';
      description = `Salió de ${oldState.channel}`;
      color = '#ff4d4d';
    }

    // 🔁 MOVE
    else if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {

      let mover = 'Desconocido';

      try {
        await new Promise(res => setTimeout(res, 500));

        const logs = await guild.fetchAuditLogs({
          limit: 5,
          type: AuditLogEvent.MemberMove
        });

        const entry = logs.entries.find(e =>
          e.target?.id === member.id &&
          Date.now() - e.createdTimestamp < 5000
        );

        if (entry) {
          mover = `${entry.executor.tag} (${entry.executor.id})`;
        }

      } catch {}

      action = '🔁 Se movió de canal';
      description = `De ${oldState.channel} → ${newState.channel}\n🧑‍💼 Movido por: ${mover}`;
      color = '#ffaa00';
    }

    // 🔇 MUTE / UNMUTE
    else if (oldState.serverMute !== newState.serverMute) {
      action = newState.serverMute ? '🔇 Muted' : '🔊 Unmuted';
      description = newState.serverMute
        ? 'Fue silenciado por un moderador'
        : 'Fue desmuteado';
      color = '#ff8800';
    }

    // 🔕 DEAF / UNDEAF
    else if (oldState.serverDeaf !== newState.serverDeaf) {
      action = newState.serverDeaf ? '🔕 Deafened' : '🔊 Undeafened';
      description = newState.serverDeaf
        ? 'Fue ensordecido por un moderador'
        : 'Ya puede escuchar';
      color = '#aa00ff';
    }

    if (!action) return;

    const embed = createLogEmbed({
      title: action,
      color,
      user: member.user,
      fields: [
        {
          name: '👤 Usuario',
          value: `${member.user}\n🆔 \`${member.id}\``,
          inline: false
        },
        {
          name: '📌 Detalles',
          value: description,
          inline: false
        }
      ],
      footer: `Servidor: ${guild.name}`
    });

    await logChannel.send({ embeds: [embed] });

  }
};