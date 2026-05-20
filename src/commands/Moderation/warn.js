import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { logModerationAction } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { WarningService } from '../../services/warningService.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { t, pickLanguage } from '../../services/i18n.js';

export default {
    data: new SlashCommandBuilder()
        .setName("warn")
        .setDescription("Warn a user")
        .addUserOption((o) =>
            o
                .setName("target")
                .setRequired(true)
                .setDescription("User to warn"),
        )
        .addStringOption((o) =>
            o
                .setName("reason")
                .setRequired(true)
                .setDescription("Reason for the warning"),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    category: "moderation",

    async execute(interaction, config, client) {
        const lang = pickLanguage(config, interaction.guild);
        try {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                throw new Error(t(lang, 'wolf.cmd.mod.warn.permDenied'));
            }

            const target = interaction.options.getUser("target");
            const member = interaction.options.getMember("target");
            const reason = interaction.options.getString("reason");
            const moderator = interaction.user;
            const guildId = interaction.guildId;

            if (!member) {
                throw new Error(t(lang, 'wolf.cmd.mod.warn.notInServer'));
            }

            const result = await WarningService.addWarning({
                guildId,
                userId: target.id,
                moderatorId: moderator.id,
                reason,
                timestamp: Date.now()
            });

            if (!result.success) {
                throw new Error(t(lang, 'wolf.cmd.mod.warn.dbError'));
            }

            const totalWarns = result.totalCount;

            await logModerationAction({
                client,
                guild: interaction.guild,
                event: {
                    action: "User Warned",
                    target: `${target.tag} (${target.id})`,
                    executor: `${moderator.tag} (${moderator.id})`,
                    reason,
                    metadata: {
                        userId: target.id,
                        moderatorId: moderator.id,
                        totalWarns,
                        warningNumber: totalWarns,
                        warningId: result.id
                    }
                }
            });

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    successEmbed(
                        t(lang, 'wolf.cmd.mod.warn.successTitle', { user: target.tag }),
                        t(lang, 'wolf.cmd.mod.warn.successDesc', { reason, count: totalWarns }),
                    ),
                ],
            });
        } catch (error) {
            logger.error('Warn command error:', error);
            await handleInteractionError(interaction, error, { subtype: 'warn_failed' });
        }
    }
};
