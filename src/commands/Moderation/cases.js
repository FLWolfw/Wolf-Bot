import { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } from 'discord.js';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { getModerationCases } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { t, pickLanguage } from '../../services/i18n.js';

export default {
    data: new SlashCommandBuilder()
        .setName('cases')
        .setDescription('View moderation cases and audit logs')
        .setDefaultMemberPermissions(PermissionFlagsBits.ViewAuditLog)
        .setDMPermission(false)
        .addStringOption(option =>
            option.setName('filter')
                .setDescription('Filter cases by type or user')
                .addChoices(
                    { name: 'All Cases', value: 'all' },
                    { name: 'Bans', value: 'Member Banned' },
                    { name: 'Kicks', value: 'Member Kicked' },
                    { name: 'Timeouts', value: 'Member Timed Out' },
                    { name: 'Warnings', value: 'User Warned' }
                )
        )
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Filter cases by specific user')
        )
        .addIntegerOption(option =>
            option.setName('limit')
                .setDescription('Number of cases to show (default: 10)')
                .setMinValue(1)
                .setMaxValue(50)
        ),

    async execute(interaction, config, client) {
        const lang = pickLanguage(config, interaction.guild);
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`Cases interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'cases'
            });
            return;
        }

        try {
            const filterType = interaction.options.getString('filter') || 'all';
            const targetUser = interaction.options.getUser('user');
            const limit = interaction.options.getInteger('limit') || 10;

            const filters = {
                limit,
                action: filterType === 'all' ? undefined : filterType,
                userId: targetUser?.id
            };

            const cases = await getModerationCases(interaction.guild.id, filters);

            if (cases.length === 0) {
                throw new Error(targetUser
                    ? t(lang, 'wolf.cmd.mod.cases.noResultsUser', { user: targetUser.tag })
                    : filterType === 'all'
                        ? t(lang, 'wolf.cmd.mod.cases.noResultsAll')
                        : t(lang, 'wolf.cmd.mod.cases.noResults', { type: filterType })
                );
            }

            const CASES_PER_PAGE = 5;
            const totalPages = Math.ceil(cases.length / CASES_PER_PAGE);
            let currentPage = 1;

            const createCasesEmbed = (page) => {
                const startIndex = (page - 1) * CASES_PER_PAGE;
                const pageCases = cases.slice(startIndex, startIndex + CASES_PER_PAGE);

                const embed = createEmbed({
                    title: t(lang, 'wolf.cmd.mod.cases.title'),
                    description: t(lang, 'wolf.cmd.mod.cases.desc', { guild: interaction.guild.name, page, total: totalPages })
                });

                pageCases.forEach(case_ => {
                    const date = new Date(case_.createdAt).toLocaleDateString();
                    const time = new Date(case_.createdAt).toLocaleTimeString();

                    embed.addFields({
                        name: t(lang, 'wolf.cmd.mod.cases.fieldName', { id: case_.caseId, action: case_.action }),
                        value: t(lang, 'wolf.cmd.mod.cases.fieldValue', {
                            target: case_.target,
                            executor: case_.executor,
                            date,
                            time,
                            reason: case_.reason || t(lang, 'wolf.cmd.mod.cases.noReason')
                        }),
                        inline: false
                    });
                });

                embed.setFooter({
                    text: targetUser
                        ? t(lang, 'wolf.cmd.mod.cases.footerUser', { total: cases.length, filter: filterType, user: targetUser.tag })
                        : t(lang, 'wolf.cmd.mod.cases.footer', { total: cases.length, filter: filterType })
                });

                return embed;
            };

            const createNavigationRow = (page) => {
                const row = new ActionRowBuilder();

                const prevButton = new ButtonBuilder()
                    .setCustomId('prev_page')
                    .setLabel('⬅️ Previous')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page === 1);

                const pageInfoButton = new ButtonBuilder()
                    .setCustomId('page_info')
                    .setLabel(t(lang, 'wolf.cmd.mod.cases.pageBtn', { page, total: totalPages }))
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(true);

                const nextButton = new ButtonBuilder()
                    .setCustomId('next_page')
                    .setLabel('Next ➡️')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page === totalPages);

                row.addComponents(prevButton, pageInfoButton, nextButton);
                return row;
            };

            const message = await interaction.editReply({
                embeds: [createCasesEmbed(currentPage)],
                components: [createNavigationRow(currentPage)]
            });

            const collector = message.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 120000
            });

            collector.on('collect', async (buttonInteraction) => {
                await buttonInteraction.deferUpdate();

                if (buttonInteraction.user.id !== interaction.user.id) {
                    await buttonInteraction.followUp({
                        content: t(lang, 'wolf.cmd.mod.cases.buttonOnly'),
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                const { customId } = buttonInteraction;

                if (customId === 'prev_page' && currentPage > 1) {
                    currentPage--;
                } else if (customId === 'next_page' && currentPage < totalPages) {
                    currentPage++;
                }

                await buttonInteraction.editReply({
                    embeds: [createCasesEmbed(currentPage)],
                    components: [createNavigationRow(currentPage)]
                });
            });

            collector.on('end', async () => {
                const disabledRow = createNavigationRow(currentPage);
                disabledRow.components.forEach(button => button.setDisabled(true));
                try {
                    await message.edit({ components: [disabledRow] });
                } catch (_) {}
            });

        } catch (error) {
            logger.error('Error in cases command:', error);
            return InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        'System Error',
                        t(lang, 'wolf.cmd.mod.cases.sysError')
                    )
                ],
                flags: MessageFlags.Ephemeral
            });
        }
    }
};
