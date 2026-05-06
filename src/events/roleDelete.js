import { Events, AuditLogEvent } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';
import { buildRoleAuditFields } from '../utils/roleLogFields.js';

export default {
  name: Events.GuildRoleDelete,
  once: false,

  async execute(role) {

    try {

      if (!role.guild) return;

      const fields =
        buildRoleAuditFields(
          role,
          { includeMemberCount: true }
        );

      try {

        const fetchedLogs =
          await role.guild.fetchAuditLogs({
            limit: 1,
            type: AuditLogEvent.RoleDelete
          });

        fetchedLogs.entries.first();

      } catch (err) {

        logger.warn(
          'Error leyendo audit logs (roleDelete):',
          err
        );

      }

      // 🔥 NUEVO SISTEMA ÚNICO
      await logEvent({
        client: role.client,
        guildId: role.guild.id,
        eventType: EVENT_TYPES.ROLE_DELETE,
        data: {
          description:
            `A role was deleted: ${role.name}`,
          fields
        }
      });

    } catch (error) {

      logger.error(
        'Error in roleDelete event:',
        error
      );

    }
  }
};