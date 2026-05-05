import { Events } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';
import { sendLog } from '../utils/discordLogger.js';

export default {
  name: Events.UserUpdate,
  once: false,

  async execute(oldUser, newUser) {
    try {
      if (oldUser.bot) return;

      const usernameChanged = oldUser.username !== newUser.username;
      const discriminatorChanged = oldUser.discriminator !== newUser.discriminator;

      // 🔥 NUEVO → AVATAR
      const oldAvatar = oldUser.displayAvatarURL({ size: 1024 });
      const newAvatar = newUser.displayAvatarURL({ size: 1024 });

      const avatarChanged = oldAvatar !== newAvatar;

      if (!usernameChanged && !discriminatorChanged && !avatarChanged) return;

      const guilds = [...newUser.client.guilds.cache.values()];

      for (const guild of guilds) {
        if (!guild.members.cache.has(newUser.id)) continue;

        // =====================================
        // 🧠 AVATAR
        // =====================================
        if (avatarChanged) {
          await sendLog({
            title: '🧠 Cambio de avatar global',
            description: `${newUser.tag} cambió su avatar`,
            color: 0x5865f2,
            thumbnail: newAvatar,
            fields: [
              {
                name: 'Antes',
                value: `[Ver avatar](${oldAvatar})`,
                inline: true
              },
              {
                name: 'Ahora',
                value: `[Ver avatar](${newAvatar})`,
                inline: true
              }
            ]
          });
        }

        // =====================================
        // ✏️ USERNAME
        // =====================================
        if (usernameChanged || discriminatorChanged) {

          const fields = [];

          if (usernameChanged) {
            fields.push(
              { name: 'Old Username', value: oldUser.username, inline: true },
              { name: 'New Username', value: newUser.username, inline: true }
            );
          }

          if (discriminatorChanged) {
            fields.push(
              { name: 'Old Tag', value: `#${oldUser.discriminator}`, inline: true },
              { name: 'New Tag', value: `#${newUser.discriminator}`, inline: true }
            );
          }

          await logEvent({
            client: newUser.client,
            guildId: guild.id,
            eventType: EVENT_TYPES.MEMBER_NAME_CHANGE,
            data: {
              description: `${newUser.tag} updated their username`,
              userId: newUser.id,
              fields
            }
          });
        }
      }

    } catch (error) {
      logger.error('Error in userUpdate event:', error);
    }
  }
};