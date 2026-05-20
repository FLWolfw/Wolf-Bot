import { botConfig, getColor } from '../../../config/bot.js';
import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    RoleSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    ComponentType,
    EmbedBuilder,
} from 'discord.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { successEmbed, errorEmbed } from '../../../utils/embeds.js';
import { logger } from '../../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../../utils/errorHandler.js';
import { getGuildConfig, setGuildConfig } from '../../../services/guildConfig.js';
import { getWelcomeConfig } from '../../../utils/database.js';
import { validateAutoVerifyCriteria } from '../../../services/verificationService.js';
import { botHasPermission } from '../../../utils/permissionGuard.js';
import { t, pickLanguage } from '../../../services/i18n.js';

const autoVerifyDefaults = botConfig.verification?.autoVerify || {};
const minAccountAgeDays = autoVerifyDefaults.minAccountAge ?? 1;
const maxAccountAgeDays = autoVerifyDefaults.maxAccountAge ?? 365;
const defaultAccountAgeDays = autoVerifyDefaults.defaultAccountAgeDays ?? 7;

// ─── Embed & Menu Builders ────────────────────────────────────────────────────

function buildDashboardEmbed(cfg, guild, conflictSummary = '', lang) {
    const autoVerify = cfg.verification?.autoVerify;
    const autoVerifyRole = autoVerify?.roleId ? guild.roles.cache.get(autoVerify.roleId) : null;
    
    let criteriaDescription = `\`${t(lang, 'wolf.cmd.verification.dashboard.notSet')}\``;
    if (autoVerify?.criteria) {
        switch (autoVerify.criteria) {
            case "account_age":
                criteriaDescription = t(lang, 'wolf.cmd.autoverify.dashboard.criteriaAge', { days: autoVerify.accountAgeDays });
                break;
            case "none":
                criteriaDescription = t(lang, 'wolf.cmd.autoverify.dashboard.criteriaNone');
                break;
        }
    }

    const embed = new EmbedBuilder()
        .setTitle(t(lang, 'wolf.cmd.autoverify.dashboard.title'))
        .setDescription(t(lang, 'wolf.cmd.autoverify.dashboard.description', { guild: guild.name }))
        .setColor(getColor('info'))
        .addFields(
            { name: t(lang, 'wolf.cmd.verification.dashboard.fieldStatus'), value: autoVerify?.enabled ? t(lang, 'wolf.cmd.verification.dashboard.enabled') : t(lang, 'wolf.cmd.verification.dashboard.disabled'), inline: true },
            { name: t(lang, 'wolf.cmd.verification.dashboard.fieldRole'), value: autoVerifyRole ? autoVerifyRole.toString() : `\`${t(lang, 'wolf.cmd.verification.dashboard.notSet')}\``, inline: true },
            { name: t(lang, 'wolf.cmd.autoverify.dashboard.criteriaTitle'), value: criteriaDescription, inline: true },
            { name: t(lang, 'wolf.cmd.autoverify.dashboard.fieldAge'), value: autoVerify?.accountAgeDays ? t(lang, 'wolf.cmd.autoverify.dashboard.ageDaysValue', { days: autoVerify.accountAgeDays }) : t(lang, 'wolf.cmd.autoverify.dashboard.na'), inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
        );

    if (conflictSummary) {
        embed.addFields({ name: t(lang, 'wolf.cmd.verification.dashboard.fieldConflicts'), value: conflictSummary, inline: false });
    }

    return embed
        .setFooter({ text: t(lang, 'wolf.cmd.verification.dashboard.footer') })
        .setTimestamp();
}

function buildSelectMenu(guildId, lang) {
    return new StringSelectMenuBuilder()
        .setCustomId(`autoverify_cfg_${guildId}`)
        .setPlaceholder(t(lang, 'wolf.cmd.verification.dashboard.placeholder'))
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel(t(lang, 'wolf.cmd.autoverify.dashboard.optRoleLabel'))
                .setDescription(t(lang, 'wolf.cmd.autoverify.dashboard.optRoleDesc'))
                .setValue('role')
                .setEmoji('🏷️'),
            new StringSelectMenuOptionBuilder()
                .setLabel(t(lang, 'wolf.cmd.autoverify.dashboard.optAgeLabel'))
                .setDescription(t(lang, 'wolf.cmd.autoverify.dashboard.optAgeDesc'))
                .setValue('account_age')
                .setEmoji('📅'),
        );
}

function buildButtonRow(cfg, guildId, disabled = false, lang) {
    const autoVerifyOn = cfg.verification?.autoVerify?.enabled === true;
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`autoverify_cfg_criteria_${guildId}`)
            .setLabel(t(lang, 'wolf.cmd.autoverify.dashboard.btnCriteria'))
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🎯')
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(`autoverify_cfg_toggle_${guildId}`)
            .setLabel(t(lang, 'wolf.cmd.autoverify.dashboard.btnToggle'))
            .setStyle(autoVerifyOn ? ButtonStyle.Success : ButtonStyle.Danger)
            .setEmoji('🤖')
            .setDisabled(disabled),
    );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function refreshDashboard(rootInteraction, cfg, guildId, client) {
    try {
        const lang = pickLanguage(cfg, rootInteraction.guild);
        const selectMenu = buildSelectMenu(guildId, lang);
        
        // Get conflict summary
        let conflictSummary = '';
        try {
            const welcomeConfig = await getWelcomeConfig(client, guildId);
            const verificationEnabled = Boolean(cfg.verification?.enabled);
            const autoRoleConfigured = Boolean(cfg.autoRole) || (Array.isArray(welcomeConfig.roleIds) && welcomeConfig.roleIds.length > 0);
            
            const conflicts = [
                verificationEnabled ? t(lang, 'wolf.cmd.autoverify.dashboard.blockingMsgVerif') : null,
                autoRoleConfigured ? t(lang, 'wolf.cmd.autoverify.dashboard.blockingMsgAutoRole') : null
            ].filter(Boolean);
            
            if (conflicts.length > 0) {
                conflictSummary = conflicts.join('\n');
            }
        } catch (error) {
            logger.warn('Could not fetch autoverify dashboard conflicts:', error.message);
        }
        
        await InteractionHelper.safeEditReply(rootInteraction, {
            embeds: [buildDashboardEmbed(cfg, rootInteraction.guild, conflictSummary, lang)],
            components: [
                buildButtonRow(cfg, guildId, false, lang),
                new ActionRowBuilder().addComponents(selectMenu),
            ],
            flags: MessageFlags.Ephemeral,
        });
    } catch (error) {
        logger.debug('Could not refresh autoverify dashboard (interaction may have expired):', error.message);
    }
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export default {
    async execute(interaction, config, client) {
        try {
            const guildId = interaction.guild.id;
            const guildConfig = await getGuildConfig(client, guildId);
            const lang = pickLanguage(guildConfig, interaction.guild);

            // Check if auto-verification is configured
            if (!guildConfig.verification?.autoVerify?.enabled) {
                // Check for blocking systems
                const welcomeConfig = await getWelcomeConfig(client, guildId);
                const verificationEnabled = Boolean(guildConfig.verification?.enabled);
                const autoRoleConfigured = Boolean(guildConfig.autoRole) || (Array.isArray(welcomeConfig.roleIds) && welcomeConfig.roleIds.length > 0);
                
                const blockingMessage = [];
                if (verificationEnabled) blockingMessage.push(t(lang, 'wolf.cmd.autoverify.dashboard.blockingMsgVerif'));
                if (autoRoleConfigured) blockingMessage.push(t(lang, 'wolf.cmd.autoverify.dashboard.blockingMsgAutoRole'));

                const blockingText = blockingMessage.length > 0 
                    ? `${t(lang, 'wolf.cmd.autoverify.dashboard.blockingTextHeader')}\n${blockingMessage.map(msg => `• ${msg}`).join('\n')}`
                    : '';

                return await InteractionHelper.safeReply(interaction, {
                    embeds: [
                        new EmbedBuilder()
                            .setTitle(t(lang, 'wolf.cmd.autoverify.dashboard.title'))
                            .setDescription(t(lang, 'wolf.cmd.autoverify.dashboard.notConfiguredDesc', { blockingText }))
                            .setColor(getColor('warning'))
                            .setFooter({ text: t(lang, 'wolf.cmd.verification.dashboard.footer') })
                            .setTimestamp()
                    ],
                    flags: MessageFlags.Ephemeral
                });
            }

            await InteractionHelper.safeDefer(interaction, { ephemeral: true });

            const selectMenu = buildSelectMenu(guildId, lang);
            
            // Get conflict summary
            let conflictSummary = '';
            try {
                const welcomeConfig = await getWelcomeConfig(client, guildId);
                const verificationEnabled = Boolean(guildConfig.verification?.enabled);
                const autoRoleConfigured = Boolean(guildConfig.autoRole) || (Array.isArray(welcomeConfig.roleIds) && welcomeConfig.roleIds.length > 0);
                
                const conflicts = [
                    verificationEnabled ? t(lang, 'wolf.cmd.autoverify.dashboard.blockingMsgVerif') : null,
                    autoRoleConfigured ? t(lang, 'wolf.cmd.autoverify.dashboard.blockingMsgAutoRole') : null
                ].filter(Boolean);
                
                if (conflicts.length > 0) {
                    conflictSummary = conflicts.join('\n');
                }
            } catch (error) {
                logger.warn('Could not fetch autoverify dashboard conflicts:', error.message);
            }

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [buildDashboardEmbed(guildConfig, interaction.guild, conflictSummary, lang)],
                components: [
                    buildButtonRow(guildConfig, guildId, false, lang),
                    new ActionRowBuilder().addComponents(selectMenu),
                ],
                flags: MessageFlags.Ephemeral,
            });

            // ── Select collector ──────────────────────────────────────────────
            const collector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                filter: i =>
                    i.user.id === interaction.user.id && i.customId === `autoverify_cfg_${guildId}`,
                time: 600_000,
            });

            collector.on('collect', async selectInteraction => {
                const selectedOption = selectInteraction.values[0];
                try {
                    switch (selectedOption) {
                        case 'role':
                            await handleRole(selectInteraction, interaction, guildConfig, guildId, client, lang);
                            break;
                        case 'account_age':
                            await handleAccountAge(selectInteraction, interaction, guildConfig, guildId, client, lang);
                            break;
                    }
                } catch (error) {
                    if (error instanceof TitanBotError) {
                        logger.debug(`Autoverify config validation error: ${error.message}`);
                    } else {
                        logger.error('Unexpected autoverify dashboard error:', error);
                    }

                    const errorMessage =
                        error instanceof TitanBotError
                            ? error.userMessage || t(lang, 'wolf.cmd.verification.dashboard.errProcessing')
                            : t(lang, 'wolf.cmd.verification.dashboard.errUpdating');

                    if (!selectInteraction.replied && !selectInteraction.deferred) {
                        await selectInteraction.deferUpdate().catch(() => {});
                    }

                    await selectInteraction
                        .followUp({
                            embeds: [errorEmbed(t(lang, 'wolf.cmd.verification.dashboard.errTitle'), errorMessage)],
                            flags: MessageFlags.Ephemeral,
                        })
                        .catch(() => {});
                }
            });

            // ── Button collector for buttons ─────────────────────────────────────
            const btnCollector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.Button,
                filter: i =>
                    i.user.id === interaction.user.id && 
                    (i.customId === `autoverify_cfg_toggle_${guildId}` || i.customId === `autoverify_cfg_criteria_${guildId}`),
                time: 600_000,
            });

            btnCollector.on('collect', async btnInteraction => {
                try {
                    if (btnInteraction.customId === `autoverify_cfg_criteria_${guildId}`) {
                        await handleCriteria(btnInteraction, interaction, guildConfig, guildId, client, lang);
                    } else if (btnInteraction.customId === `autoverify_cfg_toggle_${guildId}`) {
                        await btnInteraction.deferUpdate().catch(() => null);
                        guildConfig.verification.autoVerify.enabled = !guildConfig.verification.autoVerify.enabled;
                        await setGuildConfig(client, guildId, guildConfig);
                        
                        await btnInteraction.followUp({
                            embeds: [
                                successEmbed(
                                    t(lang, 'wolf.cmd.autoverify.dashboard.statusUpdatedTitle'),
                                    t(lang, 'wolf.cmd.autoverify.dashboard.statusUpdatedDesc', {
                                        status: guildConfig.verification.autoVerify.enabled
                                            ? t(lang, 'wolf.cmd.verification.dashboard.enabled')
                                            : t(lang, 'wolf.cmd.verification.dashboard.disabled')
                                    }),
                                ),
                            ],
                            flags: MessageFlags.Ephemeral,
                        });

                        await refreshDashboard(interaction, guildConfig, guildId, client);
                    }
                } catch (err) {
                    logger.debug('Button interaction error:', err.message);
                }
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    btnCollector.stop();
                    try {
                        const timeoutEmbed = new EmbedBuilder()
                            .setTitle(t(lang, 'wolf.cmd.verification.dashboard.timeoutTitle'))
                            .setDescription(t(lang, 'wolf.cmd.verification.dashboard.timeoutDesc'))
                            .setColor(getColor('error'));
                        await InteractionHelper.safeEditReply(interaction, {
                            embeds: [timeoutEmbed],
                            components: [],
                            flags: MessageFlags.Ephemeral,
                        });
                    } catch (error) {
                        logger.debug('Could not update dashboard on timeout:', error.message);
                    }
                }
            });
        } catch (error) {
            if (error instanceof TitanBotError) throw error;
            logger.error('Unexpected error in autoverify_dashboard:', error);
            throw new TitanBotError(
                `Auto-verification dashboard failed: ${error.message}`,
                ErrorTypes.UNKNOWN,
                'Failed to open the auto-verification dashboard.',
            );
        }
    },
};

// ─── Handle Criteria ──────────────────────────────────────────────────────────

async function handleCriteria(selectInteraction, rootInteraction, guildConfig, guildId, client, lang) {
    // Defer the interaction if it's a button, otherwise it was already deferred by select menu
    if (!selectInteraction.deferred) {
        await selectInteraction.deferUpdate().catch(() => null);
    }
    
    const criteriaEmbed = new EmbedBuilder()
        .setTitle(t(lang, 'wolf.cmd.autoverify.dashboard.actionCriteriaModalTitle'))
        .setDescription(t(lang, 'wolf.cmd.autoverify.dashboard.actionCriteriaModalDesc'))
        .setColor(getColor('info'));

    const criteriaMenu = new StringSelectMenuBuilder()
        .setCustomId('autoverify_criteria_select')
        .setPlaceholder(t(lang, 'wolf.cmd.autoverify.dashboard.actionCriteriaPlaceholder'))
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel(t(lang, 'wolf.cmd.autoverify.dashboard.actionCriteriaOptAge', { days: defaultAccountAgeDays }))
                .setDescription(t(lang, 'wolf.cmd.autoverify.dashboard.actionCriteriaOptAgeDesc'))
                .setValue('account_age'),
            new StringSelectMenuOptionBuilder()
                .setLabel(t(lang, 'wolf.cmd.autoverify.dashboard.actionCriteriaOptNone'))
                .setDescription(t(lang, 'wolf.cmd.autoverify.dashboard.actionCriteriaOptNoneDesc'))
                .setValue('none'),
        );

    await selectInteraction.followUp({
        embeds: [criteriaEmbed],
        components: [new ActionRowBuilder().addComponents(criteriaMenu)],
        flags: MessageFlags.Ephemeral,
    });

    const criteriaCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'autoverify_criteria_select',
        time: 60_000,
        max: 1,
    });

    criteriaCollector.on('collect', async criteriaInteraction => {
        await criteriaInteraction.deferUpdate();
        const newCriteria = criteriaInteraction.values[0];

        guildConfig.verification.autoVerify.criteria = newCriteria;
        
        // Reset age-related fields if not using them
        if (newCriteria !== 'account_age') {
            guildConfig.verification.autoVerify.accountAgeDays = null;
        } else if (!guildConfig.verification.autoVerify.accountAgeDays) {
            guildConfig.verification.autoVerify.accountAgeDays = defaultAccountAgeDays;
        }

        await setGuildConfig(client, guildId, guildConfig);

        let criteriaDisplay = '';
        switch (newCriteria) {
            case 'account_age':
                criteriaDisplay = t(lang, 'wolf.cmd.autoverify.admin.criteriaAgeDesc', { days: guildConfig.verification.autoVerify.accountAgeDays });
                break;
            case 'none':
                criteriaDisplay = t(lang, 'wolf.cmd.autoverify.admin.criteriaNoneDesc');
                break;
        }

        await criteriaInteraction.followUp({
            embeds: [
                successEmbed(
                    t(lang, 'wolf.cmd.autoverify.dashboard.actionCriteriaSuccessTitle'),
                    t(lang, 'wolf.cmd.autoverify.dashboard.actionCriteriaSuccessDesc', { criteria: criteriaDisplay })
                )
            ],
            flags: MessageFlags.Ephemeral,
        });

        await refreshDashboard(rootInteraction, guildConfig, guildId, client);
    });

    criteriaCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            selectInteraction
                .followUp({
                    embeds: [
                        errorEmbed(
                            t(lang, 'wolf.cmd.autoverify.dashboard.actionCriteriaTimeoutTitle'),
                            t(lang, 'wolf.cmd.autoverify.dashboard.actionCriteriaTimeoutDesc')
                        )
                    ],
                    flags: MessageFlags.Ephemeral,
                })
                .catch(() => {});
        }
    });
}

// ─── Handle Role ──────────────────────────────────────────────────────────────

async function handleRole(selectInteraction, rootInteraction, guildConfig, guildId, client, lang) {
    await selectInteraction.deferUpdate();

    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('autoverify_role_select')
        .setPlaceholder(t(lang, 'wolf.cmd.verification.dashboard.actionRolePlaceholder'))
        .setMaxValues(1);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle(`🏷️ ${t(lang, 'wolf.cmd.autoverify.dashboard.optRoleLabel')}`)
                .setDescription(t(lang, 'wolf.cmd.autoverify.dashboard.optRoleDesc'))
                .setColor(getColor('info')),
        ],
        components: [new ActionRowBuilder().addComponents(roleSelect)],
        flags: MessageFlags.Ephemeral,
    });

    const roleCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.RoleSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'autoverify_role_select',
        time: 60_000,
        max: 1,
    });

    roleCollector.on('collect', async roleInteraction => {
        await roleInteraction.deferUpdate();
        const role = roleInteraction.roles.first();

        if (role.id === rootInteraction.guild.id || role.managed) {
            await roleInteraction.followUp({
                embeds: [
                    errorEmbed(
                        t(lang, 'wolf.cmd.verification.dashboard.errTitle'),
                        t(lang, 'wolf.cmd.verification.admin.invalidRoleError'),
                    ),
                ],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const botMember = rootInteraction.guild.members.me;
        if (role.position >= botMember.roles.highest.position) {
            await roleInteraction.followUp({
                embeds: [
                    errorEmbed(
                        t(lang, 'wolf.cmd.verification.dashboard.errTitle'),
                        t(lang, 'wolf.cmd.autoverify.admin.roleHierarchyError'),
                    ),
                ],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        guildConfig.verification.autoVerify.roleId = role.id;
        await setGuildConfig(client, guildId, guildConfig);

        await roleInteraction.followUp({
            embeds: [
                successEmbed(
                    t(lang, 'wolf.cmd.verification.dashboard.actionRoleSuccessTitle'),
                    t(lang, 'wolf.cmd.verification.dashboard.actionRoleSuccessDesc', { role: role.toString() })
                )
            ],
            flags: MessageFlags.Ephemeral,
        });

        await refreshDashboard(rootInteraction, guildConfig, guildId, client);
    });

    roleCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            selectInteraction
                .followUp({
                    embeds: [
                        errorEmbed(
                            t(lang, 'wolf.cmd.verification.dashboard.actionRoleTimeoutTitle'),
                            t(lang, 'wolf.cmd.verification.dashboard.actionRoleTimeoutDesc')
                        )
                    ],
                    flags: MessageFlags.Ephemeral,
                })
                .catch(() => {});
        }
    });
}

// ─── Handle Account Age ────────────────────────────────────────────────────────

async function handleAccountAge(selectInteraction, rootInteraction, guildConfig, guildId, client, lang) {
    const modal = new ModalBuilder()
        .setCustomId('autoverify_account_age_modal')
        .setTitle(t(lang, 'wolf.cmd.autoverify.dashboard.actionAgeModalTitle'))
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('age_input')
                    .setLabel(t(lang, 'wolf.cmd.autoverify.dashboard.actionAgeInputLabel'))
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder(t(lang, 'wolf.cmd.autoverify.dashboard.actionAgeInputPlaceholder', { min: minAccountAgeDays, max: maxAccountAgeDays }))
                    .setValue((guildConfig.verification.autoVerify.accountAgeDays || defaultAccountAgeDays).toString())
                    .setRequired(true),
            ),
        );

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i =>
                i.customId === 'autoverify_account_age_modal' && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const inputValue = submitted.fields.getTextInputValue('age_input').trim();
    const days = parseInt(inputValue, 10);

    if (isNaN(days) || days < minAccountAgeDays || days > maxAccountAgeDays) {
        await submitted.reply({
            embeds: [
                errorEmbed(
                    t(lang, 'wolf.cmd.autoverify.dashboard.actionAgeErrTitle'),
                    t(lang, 'wolf.cmd.autoverify.dashboard.actionAgeErrDesc', { min: minAccountAgeDays, max: maxAccountAgeDays })
                )
            ],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    guildConfig.verification.autoVerify.accountAgeDays = days;
    await setGuildConfig(client, guildId, guildConfig);

    await submitted.reply({
        embeds: [
            successEmbed(
                t(lang, 'wolf.cmd.autoverify.dashboard.actionAgeSuccessTitle'),
                t(lang, 'wolf.cmd.autoverify.dashboard.actionAgeSuccessDesc', { days })
            )
        ],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, guildConfig, guildId, client);
}
