import { Events, AuditLogEvent } from 'discord.js';
import { sendLog } from '../utils/discordLogger.js';
import { logger } from '../utils/logger.js';

export default {
  name: Events.ChannelUpdate,

  async execute(oldChannel, newChannel) {
    try {
      if (!newChannel.guild) return;

      let changes = [];

      // Nombre cambiado
      if (oldChannel.name !== newChannel.name) {
        changes.push(`Nombre: ${oldChannel.name} → ${newChannel.name}`);
      }

      // Topic cambiado (solo text)
      if (oldChannel.topic !== newChannel.topic) {
        changes.push(`Topic cambiado`);
      }

      if (changes.length === 0) return;

      let executor = 'Desconocido';

      try {
        const fetchedLogs = await newChannel.guild.fetchAuditLogs({
          limit: 1,
          type: AuditLogEvent.ChannelUpdate
        });

        const log = fetchedLogs.entries.first();

        if (
          log &&
          log.target.id === newChannel.id &&
          Date.now() - log.createdTimestamp < 5000
        ) {
          executor = log.executor?.tag || 'Desconocido';
        }

      } catch (err) {
        logger.warn('Error audit logs channelUpdate:', err);
      }

      await sendLog({
        title: '⚙️ Canal modificado',
        description: `${newChannel.name}`,
        color: 0xffff00,
        fields: [
          {
            name: 'Cambios',
            value: changes.join('\n'),
            inline: false
          },
          {
            name: '🧑‍💼 Modificado por',
            value: executor,
            inline: true
          }
        ]
      });

    } catch (error) {
      logger.error('Error en channelUpdate:', error);
    }
  }
};