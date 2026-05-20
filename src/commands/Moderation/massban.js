import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { errorEmbed, successEmbed, warningEmbed } from '../../utils/embeds.js';
import { logModerationAction } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { checkRateLimit } from '../../utils/rateLimiter.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { t, pickLanguage } from '../../services/i18n.js';

export default {
    data: new SlashCommandBuilder()
        .setName("massban")
        .setDescription("Ban multiple users from the server at once")
        .addStringOption(option =>
            option
                .setName("users")
                .setDescription("User IDs or mentions to ban (separated by spaces or commas)")
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("reason")
                .setDescription("Reason for the mass ban")
                .setRequired(false)
        )
        .addIntegerOption(option =>
            option
                .setName("delete_days")
                .setDescription("Number of days of messages to delete (0-7)")
                .setMinValue(0)
                .setMaxValue(7)
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    category: "moderation",

    async execute(interaction, config, client) {
        const lang = pickLanguage(config, interaction.guild);
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`Massban interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'massban'
            });
            return;
        }

        if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        t(lang, 'wolf.cmd.mod.common.permDenied'),
                        t(lang, 'wolf.cmd.mod.massban.permDenied')
                    ),
                ],
            });
        }

        const usersInput = interaction.options.getString("users");
        const reason = interaction.options.getString("reason") || t(lang, 'wolf.cmd.mod.massban.noReason');
        const deleteDays = interaction.options.getInteger("delete_days") || 0;

        try {
            const rateLimitKey = `massban_${interaction.user.id}`;
            const isAllowed = await checkRateLimit(rateLimitKey, 3, 60000);
            if (!isAllowed) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        warningEmbed(
                            t(lang, 'wolf.cmd.mod.massban.rateLimited'),
                            t(lang, 'wolf.cmd.mod.massban.rateLimitedTitle')
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
                            t(lang, 'wolf.cmd.mod.massban.invalidUsersTitle'),
                            t(lang, 'wolf.cmd.mod.massban.invalidUsers')
                        ),
                    ],
                });
            }

            if (userIds.includes(interaction.user.id)) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        errorEmbed(
                            t(lang, 'wolf.cmd.mod.massban.cantSelfTitle'),
                            t(lang, 'wolf.cmd.mod.massban.cantSelf')
                        ),
                    ],
                });
            }

            if (userIds.includes(client.user.id)) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        errorEmbed(
                            t(lang, 'wolf.cmd.mod.massban.cantBotTitle'),
                            t(lang, 'wolf.cmd.mod.massban.cantBot')
                        ),
                    ],
                });
            }

            const results = { successful: [], failed: [], skipped: [] };

            for (const userId of userIds) {
                try {
                    const user = await client.users.fetch(userId).catch(() => null);

                    if (!user) {
                        results.failed.push({ userId, reason: "User not found" });
                        continue;
                    }

                    const member = await interaction.guild.members.fetch(userId).catch(() => null);

                    if (member) {
                        if (member.roles.highest.position >= interaction.member.roles.highest.position &&
                            interaction.guild.ownerId !== interaction.user.id) {
                            results.skipped.push({ user: user.tag, userId, reason: "Cannot ban user with equal or higher role" });
                            continue;
                        }
                    }

                    await interaction.guild.members.ban(userId, {
                        reason,
                        deleteMessageDays: deleteDays
                    });

                    results.successful.push({ user: user.tag, userId });

                    await logModerationAction({
                        client,
                        guild: interaction.guild,
                        event: {
                            action: "Member Banned",
                            target: `${user.tag} (${user.id})`,
                            executor: `${interaction.user.tag} (${interaction.user.id})`,
                            reason: `${reason} (Mass Ban)`,
                            metadata: {
                                userId: user.id,
                                moderatorId: interaction.user.id,
                                massBan: true,
                                permanent: true
                            }
                        }
                    });
                } catch (error) {
                    logger.error(`Failed to ban user ${userId}:`, error);
                    results.failed.push({ userId, reason: error.message || "Unknown error" });
                }
            }

            let description = t(lang, 'wolf.cmd.mod.massban.resultHeader');

            if (results.successful.length > 0) {
                description += t(lang, 'wolf.cmd.mod.massban.successSection', { count: results.successful.length });
                results.successful.forEach(r => { description += `• ${r.user} (${r.userId})\n`; });
                description += '\n';
            }
            if (results.skipped.length > 0) {
                description += t(lang, 'wolf.cmd.mod.massban.skippedSection', { count: results.skipped.length });
                results.skipped.forEach(r => { description += `• ${r.user} - ${r.reason}\n`; });
                description += '\n';
            }
            if (results.failed.length > 0) {
                description += t(lang, 'wolf.cmd.mod.massban.failedSection', { count: results.failed.length });
                results.failed.forEach(r => { description += `• ${r.userId} - ${r.reason}\n`; });
            }

            const embedFn = results.successful.length > 0 ? successEmbed : warningEmbed;

            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    embedFn(t(lang, 'wolf.cmd.mod.massban.resultTitle'), description)
                ]
            });
        } catch (error) {
            logger.error("Error in massban command:", error);
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        "System Error",
                        t(lang, 'wolf.cmd.mod.massban.sysError')
                    ),
                ],
            });
        }
    }
};
