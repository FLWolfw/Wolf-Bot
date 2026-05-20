import { getColor } from '../../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { logEvent } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { WarningService } from '../../services/warningService.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { t, pickLanguage } from '../../services/i18n.js';

export default {
    data: new SlashCommandBuilder()
        .setName("warnings")
        .setDescription("View all warnings for a user")
        .addUserOption((o) =>
            o
                .setName("target")
                .setRequired(true)
                .setDescription("User to check warnings for"),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    category: "moderation",

    async execute(interaction, config, client) {
        const lang = pickLanguage(config, interaction.guild);
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`Warnings interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'warnings'
            });
            return;
        }

        try {
            const target = interaction.options.getUser("target");
            const guildId = interaction.guildId;

            const validWarnings = await WarningService.getWarnings(guildId, target.id);
            const totalWarns = validWarnings.length;

            if (totalWarns === 0) {
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        createEmbed({
                            title: t(lang, 'wolf.cmd.mod.warnings.noWarningsTitle', { user: target.tag }),
                            description: t(lang, 'wolf.cmd.mod.warnings.noWarningsDesc')
                        }).setColor(getColor('success')),
                    ],
                });
                return;
            }

            const embed = createEmbed({
                title: t(lang, 'wolf.cmd.mod.warnings.title', { user: target.tag }),
                description: t(lang, 'wolf.cmd.mod.warnings.totalLabel', { count: totalWarns })
            }).setColor(getColor('warning'));

            const warningFields = validWarnings
                .map((w, i) => {
                    const discordTimestamp = Math.floor(w.timestamp / 1000);
                    return {
                        name: t(lang, 'wolf.cmd.mod.warnings.fieldName', { num: i + 1, reason: w.reason.substring(0, 100) }),
                        value: t(lang, 'wolf.cmd.mod.warnings.fieldValue', { modId: w.moderatorId, ts: discordTimestamp }),
                        inline: false,
                    };
                })
                .slice(0, 25);

            embed.addFields(warningFields);

            await logEvent({
                client,
                guild: interaction.guild,
                event: {
                    action: "Warnings Viewed",
                    target: `${target.tag} (${target.id})`,
                    executor: `${interaction.user.tag} (${interaction.user.id})`,
                    reason: `Viewed ${totalWarns} warnings`,
                    metadata: {
                        userId: target.id,
                        moderatorId: interaction.user.id,
                        totalWarnings: totalWarns
                    }
                }
            });

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
        } catch (error) {
            logger.error('Warnings command error:', error);
            await handleInteractionError(interaction, error, { subtype: 'warnings_view_failed' });
        }
    }
};
