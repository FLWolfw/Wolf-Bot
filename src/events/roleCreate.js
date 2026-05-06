import { Events, AuditLogEvent } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';
import { buildRoleAuditFields } from '../utils/roleLogFields.js';
import { antiRoleCreate } from '../security/antiNuke.js';

export default {
  name: Events.GuildRoleCreate,
  once: false,

  async execute(role) {
    try {

      if (!role.guild) return;

      const fields = buildRoleAuditFields(role);

      let executorObj = null;

      try {

        const fetchedLogs =
          await role.guild.fetchAuditLogs({
            limit: 1,
            type: AuditLogEvent.RoleCreate
          });

        const log =
          fetchedLogs.entries.first();

        if (
          log &&
          log.target.id === role.id
        ) {
          executorObj = log.executor;
        }

      } catch (err) {

        logger.warn(
          'Error leyendo audit logs (roleCreate):',
          err
        );

      }

      // 🔥 ANTI-NUKE
      if (executorObj) {
        await antiRoleCreate(
          role,
          executorObj
        );
      }

      // 🔥 NUEVO SISTEMA ÚNICO
      await logEvent({
        client: role.client,
        guildId: role.guild.id,
        eventType: EVENT_TYPES.ROLE_CREATE,
        data: {
          description:
            `A new role was created: ${role.toString()}`,
          fields
        }
      });

    } catch (error) {

      logger.error(
        'Error in roleCreate event:',
        error
      );

    }
  }
};