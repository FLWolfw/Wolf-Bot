import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logEvent } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { t, pickLanguage } from '../../services/i18n.js';

export default {
    data: new SlashCommandBuilder()
        .setName("lock")
        .setDescription("Locks the current channel (prevents @everyone from sending messages).")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    category: "moderation",

    async execute(interaction, config, client) {
        const lang = pickLanguage(config, interaction.guild);
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`Lock interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'lock'
            });
            return;
        }

        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels))
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        t(lang, 'wolf.cmd.mod.common.permDenied'),
                        t(lang, 'wolf.cmd.mod.lock.permDenied'),
                    ),
                ],
            });

        const channel = interaction.channel;
        const everyoneRole = interaction.guild.roles.everyone;

        try {
            const currentPermissions = channel.permissionsFor(everyoneRole);
            if (currentPermissions.has(PermissionFlagsBits.SendMessages) === false) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        errorEmbed(
                            t(lang, 'wolf.cmd.mod.lock.alreadyLockedTitle'),
                            t(lang, 'wolf.cmd.mod.lock.alreadyLockedDesc', { channel }),
                        ),
                    ],
                });
            }

            await channel.permissionOverwrites.edit(
                everyoneRole,
                { SendMessages: false },
                { type: 0, reason: `Channel locked by ${interaction.user.tag}` },
            );

            await logEvent({
                client,
                guild: interaction.guild,
                event: {
                    action: "Channel Locked",
                    target: channel.toString(),
                    executor: `${interaction.user.tag} (${interaction.user.id})`,
                    metadata: {
                        channelId: channel.id,
                        category: channel.parent?.name || 'None',
                        moderatorId: interaction.user.id
                    }
                }
            });

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    successEmbed(
                        t(lang, 'wolf.cmd.mod.lock.successTitle'),
                        t(lang, 'wolf.cmd.mod.lock.successDesc', { channel }),
                    ),
                ],
            });
        } catch (error) {
            logger.error('Lock command error:', error);
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(t(lang, 'wolf.cmd.mod.lock.unexpectedError')),
                ],
            });
        }
    }
};
