import { Events, AuditLogEvent } from 'discord.js';
import { sendLog } from '../utils/discordLogger.js';
import { logger } from '../utils/logger.js';

export default {
  name: Events.ChannelCreate,

  async execute(channel) {
    try {
      if (!channel.guild) return;

      let executor = 'Desconocido';

      try {
        const fetchedLogs = await channel.guild.fetchAuditLogs({
          limit: 1,
          type: AuditLogEvent.ChannelCreate
        });

        const log = fetchedLogs.entries.first();

        if (log && log.target.id === channel.id) {
          executor = log.executor?.tag || 'Desconocido';
        }

      } catch (err) {
        logger.warn('Error audit logs channelCreate:', err);
      }

      await sendLog({
        title: '🆕 Canal creado',
        description: `${channel.name}`,
        color: 0x00ff00,
        fields: [
          {
            name: '🧑‍💼 Creado por',
            value: executor,
            inline: true
          },
          {
            name: '📁 Tipo',
            value: channel.type.toString(),
            inline: true
          }
        ]
      });

    } catch (error) {
      logger.error('Error en channelCreate:', error);
    }
  }
};