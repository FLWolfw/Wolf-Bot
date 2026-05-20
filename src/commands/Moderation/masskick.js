import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { errorEmbed, successEmbed, warningEmbed } from '../../utils/embeds.js';
import { logModerationAction } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { checkRateLimit } from '../../utils/rateLimiter.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { t, pickLanguage } from '../../services/i18n.js';

export default {
    data: new SlashCommandBuilder()
        .setName("masskick")
        .setDescription("Kick multiple users from the server at once")
        .addStringOption(option =>
            option
                .setName("users")
                .setDescription("User IDs or mentions to kick (separated by spaces or commas)")
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("reason")
                .setDescription("Reason for the mass kick")
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
    category: "moderation",

    async execute(interaction, config, client) {
        const lang = pickLanguage(config, interaction.guild);
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`Masskick interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'masskick'
            });
            return;
        }

        if (!interaction.member.permissions.has(PermissionFlagsBits.KickMembers)) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        t(lang, 'wolf.cmd.mod.common.permDenied'),
                        t(lang, 'wolf.cmd.mod.masskick.permDenied')
                    ),
                ],
            });
        }

        const usersInput = interaction.options.getString("users");
        const reason = interaction.options.getString("reason") || t(lang, 'wolf.cmd.mod.masskick.noReason');

        try {
            const rateLimitKey = `masskick_${interaction.user.id}`;
            const isAllowed = await checkRateLimit(rateLimitKey, 3, 60000);
            if (!isAllowed) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        warningEmbed(
                            t(lang, 'wolf.cmd.mod.masskick.rateLimited'),
                            t(lang, 'wolf.cmd.mod.masskick.rateLimitedTitle')
                        ),
                    ],
                    flags: MessageFlags.Ephemeral,
                });
            }

            const userIds = usersInput
                .replace(/<@!?(\d+)>/g, '$1')
                .split(/[\s,]+/)
                .filter(id => id && /^\d+$/.test(id))
                .slice(0, 20);

            if (userIds.length === 0) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        errorEmbed(
                            t(lang, 'wolf.cmd.mod.masskick.invalidUsersTitle'),
                            t(lang, 'wolf.cmd.mod.masskick.invalidUsers')
                        ),
                    ],
                });
            }

            if (userIds.includes(interaction.user.id)) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        errorEmbed(
                            t(lang, 'wolf.cmd.mod.masskick.cantSelfTitle'),
                            t(lang, 'wolf.cmd.mod.masskick.cantSelf')
                        ),
                    ],
                });
            }

            if (userIds.includes(client.user.id)) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        errorEmbed(
                            t(lang, 'wolf.cmd.mod.masskick.cantBotTitle'),
                            t(lang, 'wolf.cmd.mod.masskick.cantBot')
                        ),
                    ],
                });
            }

            const results = { successful: [], failed: [], skipped: [] };

            for (const userId of userIds) {
                try {
                    const member = await interaction.guild.members.fetch(userId).catch(() => null);

                    if (!member) {
                        results.failed.push({ userId, reason: "User not in server" });
                        continue;
                    }

                    if (member.roles.highest.position >= interaction.member.roles.highest.position &&
                        interaction.guild.ownerId !== interaction.user.id) {
                        results.skipped.push({ user: member.user.tag, userId, reason: "Cannot kick user with equal or higher role" });
                        continue;
                    }

                    await member.kick(reason);

                    results.successful.push({ user: member.user.tag, userId });

                    await logModerationAction({
                        client,
                        guild: interaction.guild,
                        event: {
                            action: "Member Kicked",
                            target: `${member.user.tag} (${member.user.id})`,
                            executor: `${interaction.user.tag} (${interaction.user.id})`,
                            reason: `${reason} (Mass Kick)`,
                            metadata: {
                                userId: member.user.id,
                                moderatorId: interaction.user.id,
                                massKick: true
                            }
                        }
                    });
                } catch (error) {
                    logger.error(`Failed to kick user ${userId}:`, error);
                    results.failed.push({ userId, reason: error.message || "Unknown error" });
                }
            }

            let description = t(lang, 'wolf.cmd.mod.masskick.resultHeader');

            if (results.successful.length > 0) {
                description += t(lang, 'wolf.cmd.mod.masskick.successSection', { count: results.successful.length });
                results.successful.forEach(r => { description += `• ${r.user} (${r.userId})\n`; });
                description += '\n';
            }
            if (results.skipped.length > 0) {
                description += t(lang, 'wolf.cmd.mod.masskick.skippedSection', { count: results.skipped.length });
                results.skipped.forEach(r => { description += `• ${r.user} - ${r.reason}\n`; });
                description += '\n';
            }
            if (results.failed.length > 0) {
                description += t(lang, 'wolf.cmd.mod.masskick.failedSection', { count: results.failed.length });
                results.failed.forEach(r => { description += `• ${r.userId} - ${r.reason}\n`; });
            }

            const embedFn = results.successful.length > 0 ? successEmbed : warningEmbed;

            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    embedFn(t(lang, 'wolf.cmd.mod.masskick.resultTitle'), description)
                ]
            });
        } catch (error) {
            logger.error("Error in masskick command:", error);
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        "System Error",
                        t(lang, 'wolf.cmd.mod.masskick.sysError')
                    ),
                ],
            });
        }
    }
};
