import {
  Events,
  EmbedBuilder,
  PermissionFlagsBits,
  AuditLogEvent
} from 'discord.js';

import {
  getColor
} from '../config/bot.js';

import {
  getGuildConfig
} from '../services/guildConfigService.js';

import {
  getUserApplications,
  deleteApplication
} from '../utils/database.js';

import {
  formatWelcomeMessage
} from '../utils/welcome.js';

import {
  logEvent,
  EVENT_TYPES
} from '../services/loggingService.js';

import {
  getServerCounters,
  updateCounter
} from '../services/serverstatsService.js';

import {
  getGuildBirthdays,
  deleteBirthday
} from '../utils/database.js';

import {
  deleteUserLevelData
} from '../services/leveling.js';

import {
  logger
} from '../utils/logger.js';

export default {

  name: Events.GuildMemberRemove,

  once: false,

  async execute(member) {

    try {

      const {
        guild,
        user
      } = member;

      // =====================================
      // 🔥 DETECTAR KICK
      // =====================================

      let wasKicked = false;

      let executor =
        'Desconocido';

      let reason =
        'No reason provided';

      try {

        const fetchedLogs =
          await guild.fetchAuditLogs({
            limit: 1,
            type: AuditLogEvent.MemberKick
          });

        const log =
          fetchedLogs.entries.first();

        if (
          log &&
          log.target.id === user.id &&
          Date.now() -
            log.createdTimestamp <
            5000
        ) {

          wasKicked = true;

          executor =
            log.executor?.tag ||
            'Desconocido';

          reason =
            log.reason ||
            'No reason provided';

          // 🔥 LOG KICK
          await logEvent({

            client:
              member.client,

            guildId:
              guild.id,

            eventType:
              EVENT_TYPES.MODERATION_KICK,

            data: {

              description:
                `${user.tag} was kicked`,

              userId:
                user.id,

              fields: [

                {
                  name:
                    '👤 User',

                  value:
                    `${user.tag} (${user.id})`,

                  inline: true
                },

                {
                  name:
                    '🛡️ Moderator',

                  value:
                    executor,

                  inline: true
                },

                {
                  name:
                    '📄 Reason',

                  value:
                    reason,

                  inline: false
                }

              ]
            }
          });

        }

      } catch (auditError) {

        logger.warn(
          'Error fetching audit logs for kick detection:',
          auditError
        );

      }

      // =====================================
      // 👋 LEAVE NORMAL
      // =====================================

      if (!wasKicked) {

        const config =
          await getGuildConfig(
            member.client.db,
            guild.id
          );

        // 🔥 GOODBYE USANDO NUEVA CONFIG
        if (
          config.welcome?.enabled &&
          config.welcome?.channel
        ) {

          const channel =
            guild.channels.cache.get(
              config.welcome.channel
            );

          if (
            channel?.isTextBased?.()
          ) {

            const me =
              guild.members.me;

            const permissions =
              me
                ? channel.permissionsFor(me)
                : null;

            if (
              permissions?.has([
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages
              ])
            ) {

              const formatData = {
                user,
                guild,
                member
              };

              const goodbyeMessage =
                formatWelcomeMessage(

                  config.welcome.message ||

                  '{user.tag} left the server.',

                  formatData
                );

              const embed =
                new EmbedBuilder()

                  .setTitle(
                    '👋 Goodbye'
                  )

                  .setDescription(
                    goodbyeMessage
                  )

                  .setColor(
                    getColor('error')
                  )

                  .setThumbnail(
                    user.displayAvatarURL()
                  )

                  .addFields(

                    {
                      name: 'User',

                      value:
                        `${user.tag} (${user.id})`,

                      inline: true
                    },

                    {
                      name:
                        'Member Count',

                      value:
                        guild.memberCount.toString(),

                      inline: true
                    }

                  )

                  .setTimestamp();

              await channel.send({
                embeds: [embed]
              });

            }
          }
        }

        // 🔥 LOG LEAVE
        await logEvent({

          client:
            member.client,

          guildId:
            guild.id,

          eventType:
            EVENT_TYPES.MEMBER_LEAVE,

          data: {

            description:
              `${user.tag} left the server`,

            userId:
              user.id,

            fields: [

              {
                name:
                  '👤 Member',

                value:
                  `${user.tag} (${user.id})`,

                inline: true
              },

              {
                name:
                  '👥 Member Count',

                value:
                  guild.memberCount.toString(),

                inline: true
              }

            ]
          }
        });

      }

      // =====================================
      // 🔁 CONTADORES
      // =====================================

      try {

        const counters =
          await getServerCounters(
            member.client,
            guild.id
          );

        for (
          const counter of counters
        ) {

          if (
            counter &&
            counter.type &&
            counter.channelId &&
            counter.enabled !== false
          ) {

            await updateCounter(
              member.client,
              guild,
              counter
            );

          }
        }

      } catch (error) {

        logger.debug(
          'Error updating counters on member leave:',
          error
        );

      }

      // =====================================
      // 🎂 BIRTHDAYS
      // =====================================

      try {

        const birthdays =
          await getGuildBirthdays(
            member.client,
            guild.id
          );

        if (
          birthdays[user.id]
        ) {

          const backupKey =
            `guild:${guild.id}:birthdays:left`;

          const backup =
            (
              await member.client.db.get(
                backupKey
              )
            ) || {};

          backup[user.id] =
            birthdays[user.id];

          await member.client.db.set(
            backupKey,
            backup
          );

          await deleteBirthday(
            member.client,
            guild.id,
            user.id
          );

        }

      } catch (error) {

        logger.debug(
          'Error handling birthday on member leave:',
          error
        );

      }

      // =====================================
      // 📄 APPLICATIONS
      // =====================================

      try {

        const userApplications =
          await getUserApplications(
            member.client,
            guild.id,
            user.id
          );

        if (
          userApplications &&
          userApplications.length > 0
        ) {

          for (
            const app of userApplications
          ) {

            await deleteApplication(
              member.client,
              guild.id,
              app.id,
              user.id
            );

          }
        }

      } catch (error) {

        logger.debug(
          'Error handling applications on member leave:',
          error
        );

      }

      // =====================================
      // 📈 LEVELING
      // =====================================

      try {

        await deleteUserLevelData(
          member.client,
          guild.id,
          user.id
        );

      } catch (error) {

        logger.debug(
          'Error handling leveling data on member leave:',
          error
        );

      }

    } catch (error) {

      logger.error(
        'Error in guildMemberRemove event:',
        error
      );

    }
  }
};


