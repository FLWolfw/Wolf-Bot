import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logEvent } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { sanitizeMarkdown } from '../../utils/sanitization.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { t, pickLanguage } from '../../services/i18n.js';

export default {
    data: new SlashCommandBuilder()
        .setName("dm")
        .setDescription("Send a direct message to a user (Staff only)")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("The user to send a DM to")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("message")
                .setDescription("The message to send")
                .setRequired(true)
        )
        .addBooleanOption(option =>
            option
                .setName("anonymous")
                .setDescription("Send the message anonymously (default: false)")
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setDMPermission(false),
    category: "Moderation",

    async execute(interaction, config, client) {
        const lang = pickLanguage(config, interaction.guild);
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`DM interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'dm'
            });
            return;
        }

        const targetUser = interaction.options.getUser("user");
        const message = interaction.options.getString("message");
        const anonymous = interaction.options.getBoolean("anonymous") || false;

        try {
            if (message.length > 2000) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        errorEmbed(
                            t(lang, 'wolf.cmd.mod.dm.tooLongTitle'),
                            t(lang, 'wolf.cmd.mod.dm.tooLongDesc')
                        ),
                    ],
                    flags: MessageFlags.Ephemeral,
                });
            }

            if (targetUser.bot) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        errorEmbed(
                            t(lang, 'wolf.cmd.mod.dm.cantDmBotTitle'),
                            t(lang, 'wolf.cmd.mod.dm.cantDmBotDesc')
                        ),
                    ],
                    flags: MessageFlags.Ephemeral,
                });
            }

            const sanitized = sanitizeMarkdown(message);
            const dmChannel = await targetUser.createDM();

            await dmChannel.send({
                embeds: [
                    successEmbed(
                        anonymous
                            ? t(lang, 'wolf.cmd.mod.dm.anonFrom')
                            : t(lang, 'wolf.cmd.mod.dm.namedFrom', { user: interaction.user.tag }),
                        sanitized
                    ).setFooter({
                        text: t(lang, 'wolf.cmd.mod.dm.dmFooter', { id: interaction.id })
                    })
                ]
            });

            await logEvent({
                client: interaction.client,
                guild: interaction.guild,
                event: {
                    action: "DM Sent",
                    target: `${targetUser.tag} (${targetUser.id})`,
                    executor: `${interaction.user.tag} (${interaction.user.id})`,
                    reason: `Anonymous: ${anonymous ? 'Yes' : 'No'}`,
                    metadata: {
                        userId: targetUser.id,
                        moderatorId: interaction.user.id,
                        anonymous,
                        messageLength: sanitized.length
                    }
                }
            });

            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    successEmbed(
                        t(lang, 'wolf.cmd.mod.dm.sentTitle'),
                        t(lang, 'wolf.cmd.mod.dm.sentDesc', { user: targetUser.tag })
                    ),
                ],
            });
        } catch (error) {
            logger.error('DM command error:', error);

            if (error.code === 50007) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        errorEmbed("Error", t(lang, 'wolf.cmd.mod.dm.closedDMs', { user: targetUser.tag })),
                    ],
                });
            }

            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed("Error", t(lang, 'wolf.cmd.mod.dm.sendFailed', { error: error.message })),
                ],
            });
        }
    }
};
