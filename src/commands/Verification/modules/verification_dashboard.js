import { botConfig, getColor } from '../../../config/bot.js';
import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
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
import { botHasPermission } from '../../../utils/permissionGuard.js';
import { t, pickLanguage } from '../../../services/i18n.js';

// ─── Live Panel Sync ──────────────────────────────────────────────────────────

async function updateLivePanel(guild, cfg, lang) {
    if (!cfg.channelId || !cfg.messageId) return;
    try {
        const channel = guild.channels.cache.get(cfg.channelId);
        if (!channel) return;
        const msg = await channel.messages.fetch(cfg.messageId).catch(() => null);
        if (!msg) return;

        const verifyEmbed = new EmbedBuilder()
            .setTitle(t(lang, 'wolf.cmd.verification.admin.livePanelTitle'))
            .setDescription(cfg.message || botConfig.verification.defaultMessage)
            .setColor(getColor('success'));

        const verifyButton = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('verify_user')
                .setLabel(cfg.buttonText || t(lang, 'wolf.cmd.verification.admin.livePanelDefaultButtonText'))
                .setStyle(ButtonStyle.Success)
                .setEmoji('✅'),
        );

        await msg.edit({ embeds: [verifyEmbed], components: [verifyButton] });
    } catch (error) {
        logger.warn('Could not update live verification panel:', error.message);
    }
}

// ─── Embed & Menu Builders ────────────────────────────────────────────────────

function buildDashboardEmbed(cfg, guild, verifiedUserCount = 0, conflictSummary = '', lang) {
    const channel = cfg.channelId ? `<#${cfg.channelId}>` : t(lang, 'wolf.cmd.verification.admin.dashboard.notSet');
    const role = cfg.roleId ? `<@&${cfg.roleId}>` : t(lang, 'wolf.cmd.verification.admin.dashboard.notSet');
    const rawMsg = cfg.message || botConfig.verification.defaultMessage;
    const msgPreview = `\`${rawMsg.length > 60 ? rawMsg.substring(0, 60) + '…' : rawMsg}\``;
    const buttonText = cfg.buttonText || t(lang, 'wolf.cmd.verification.admin.livePanelDefaultButtonText');

    const embed = new EmbedBuilder()
        .setTitle(t(lang, 'wolf.cmd.verification.admin.dashboard.title'))
        .setDescription(t(lang, 'wolf.cmd.verification.admin.dashboard.description', { guild: guild.name }))
        .setColor(getColor('info'))
        .addFields(
            { name: t(lang, 'wolf.cmd.verification.admin.dashboard.fieldChannel'), value: channel, inline: true },
            { name: t(lang, 'wolf.cmd.verification.admin.dashboard.fieldRole'), value: role, inline: true },
            { name: t(lang, 'wolf.cmd.verification.admin.dashboard.fieldStatus'), value: cfg.enabled !== false ? t(lang, 'wolf.cmd.verification.admin.dashboard.enabled') : t(lang, 'wolf.cmd.verification.admin.dashboard.disabled'), inline: true },
            { name: t(lang, 'wolf.cmd.verification.admin.dashboard.fieldButtonText'), value: `\`${buttonText}\``, inline: true },
            { name: t(lang, 'wolf.cmd.verification.admin.dashboard.fieldUsers'), value: t(lang, 'wolf.cmd.verification.admin.dashboard.usersCount', { count: verifiedUserCount }), inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: t(lang, 'wolf.cmd.verification.admin.dashboard.fieldMessage'), value: msgPreview, inline: false },
        );

    if (conflictSummary) {
        embed.addFields({ name: t(lang, 'wolf.cmd.verification.admin.dashboard.fieldConflicts'), value: conflictSummary, inline: false });
    }

    return embed
        .setFooter({ text: t(lang, 'wolf.cmd.verification.admin.dashboard.footer') })
        .setTimestamp();
}

function buildSelectMenu(guildId, lang) {
    return new StringSelectMenuBuilder()
        .setCustomId(`verif_cfg_${guildId}`)
        .setPlaceholder(t(lang, 'wolf.cmd.verification.admin.dashboard.placeholder'))
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel(t(lang, 'wolf.cmd.verification.admin.dashboard.optChannelLabel'))
                .setDescription(t(lang, 'wolf.cmd.verification.admin.dashboard.optChannelDesc'))
                .setValue('channel')
                .setEmoji('📢'),
            new StringSelectMenuOptionBuilder()
                .setLabel(t(lang, 'wolf.cmd.verification.admin.dashboard.optRoleLabel'))
                .setDescription(t(lang, 'wolf.cmd.verification.admin.dashboard.optRoleDesc'))
                .setValue('role')
                .setEmoji('🏷️'),
            new StringSelectMenuOptionBuilder()
                .setLabel(t(lang, 'wolf.cmd.verification.admin.dashboard.optMessageLabel'))
                .setDescription(t(lang, 'wolf.cmd.verification.admin.dashboard.optMessageDesc'))
                .setValue('message')
                .setEmoji('💬'),
            new StringSelectMenuOptionBuilder()
                .setLabel(t(lang, 'wolf.cmd.verification.admin.dashboard.optButtonLabel'))
                .setDescription(t(lang, 'wolf.cmd.verification.admin.dashboard.optButtonDesc'))
                .setValue('button_text')
                .setEmoji('🔘'),
        );
}

function buildButtonRow(cfg, guildId, disabled = false, lang) {
    const systemOn = cfg.enabled !== false;
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`verif_cfg_toggle_${guildId}`)
            .setLabel(t(lang, 'wolf.cmd.verification.admin.dashboard.btnToggle'))
            .setStyle(systemOn ? ButtonStyle.Success : ButtonStyle.Danger)
            .setEmoji('🔒')
            .setDisabled(disabled),
    );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function refreshDashboard(rootInteraction, cfg, guildId, client, lang) {
    try {
        const selectMenu = buildSelectMenu(guildId, lang);
        
        // Get verified user count and conflict summary
        let verifiedUserCount = 0;
        let conflictSummary = '';
        
        try {
            const verifiedRole = rootInteraction.guild.roles.cache.get(cfg.roleId);
            if (verifiedRole) {
                verifiedUserCount = verifiedRole.members.size;
            }
            
            const guildConfig = await getGuildConfig(client, guildId);
            const welcomeConfig = await getWelcomeConfig(client, guildId);
            const autoVerifyEnabled = Boolean(guildConfig.verification?.autoVerify?.enabled);
            const autoRoleConfigured = Boolean(guildConfig.autoRole) || (Array.isArray(welcomeConfig.roleIds) && welcomeConfig.roleIds.length > 0);
            
            const conflicts = [
                autoVerifyEnabled ? t(lang, 'wolf.cmd.verification.admin.dashboard.conflictAutoVerify') : null,
                autoRoleConfigured ? t(lang, 'wolf.cmd.verification.admin.dashboard.conflictAutoRole') : null
            ].filter(Boolean);
            
            if (conflicts.length > 0) {
                conflictSummary = conflicts.join('\n');
            }
        } catch (error) {
            logger.warn('Could not fetch verification dashboard details:', error.message);
        }
        
        await InteractionHelper.safeEditReply(rootInteraction, {
            embeds: [buildDashboardEmbed(cfg, rootInteraction.guild, verifiedUserCount, conflictSummary, lang)],
            components: [
                buildButtonRow(cfg, guildId, false, lang),
                new ActionRowBuilder().addComponents(selectMenu),
            ],
            flags: MessageFlags.Ephemeral,
        });
    } catch (error) {
        logger.debug('Could not refresh verification dashboard (interaction may have expired):', error.message);
    }
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export default {
    async execute(interaction, config, client) {
        try {
            const guildId = interaction.guild.id;
            const guildConfig = await getGuildConfig(client, guildId);
            const cfg = guildConfig.verification;
            const lang = pickLanguage(config, interaction.guild);

            if (!cfg?.channelId) {
                throw new TitanBotError(
                    'Verification not configured',
                    ErrorTypes.CONFIGURATION,
                    t(lang, 'wolf.cmd.verification.admin.dashboard.notConfiguredDesc'),
                );
            }

            await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });

            const selectMenu = buildSelectMenu(guildId, lang);

            // Get verified user count and conflict summary
            let verifiedUserCount = 0;
            let conflictSummary = '';
            
            try {
                const verifiedRole = interaction.guild.roles.cache.get(cfg.roleId);
                if (verifiedRole) {
                    verifiedUserCount = verifiedRole.members.size;
                }
                
                const welcomeConfig = await getWelcomeConfig(client, guildId);
                const autoVerifyEnabled = Boolean(guildConfig.verification?.autoVerify?.enabled);
                const autoRoleConfigured = Boolean(guildConfig.autoRole) || (Array.isArray(welcomeConfig.roleIds) && welcomeConfig.roleIds.length > 0);
                
                const conflicts = [
                    autoVerifyEnabled ? t(lang, 'wolf.cmd.verification.admin.dashboard.conflictAutoVerify') : null,
                    autoRoleConfigured ? t(lang, 'wolf.cmd.verification.admin.dashboard.conflictAutoRole') : null
                ].filter(Boolean);
                
                if (conflicts.length > 0) {
                    conflictSummary = conflicts.join('\n');
                }
            } catch (error) {
                logger.warn('Could not fetch verification dashboard details:', error.message);
            }

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [buildDashboardEmbed(cfg, interaction.guild, verifiedUserCount, conflictSummary, lang)],
                components: [
                    buildButtonRow(cfg, guildId, false, lang),
                    new ActionRowBuilder().addComponents(selectMenu),
                ],
                flags: MessageFlags.Ephemeral,
            });

            const collector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                filter: i =>
                    i.user.id === interaction.user.id && i.customId === `verif_cfg_${guildId}`,
                time: 600_000,
            });

            collector.on('collect', async selectInteraction => {
                const selectedOption = selectInteraction.values[0];
                try {
                    switch (selectedOption) {
                        case 'channel':
                            await handleChannel(selectInteraction, interaction, cfg, guildId, client, lang);
                            break;
                        case 'role':
                            await handleRole(selectInteraction, interaction, cfg, guildId, client, lang);
                            break;
                        case 'message':
                            await handleMessage(selectInteraction, interaction, cfg, guildId, client, lang);
                            break;
                        case 'button_text':
                            await handleButtonText(selectInteraction, interaction, cfg, guildId, client, lang);
                            break;
                    }
                } catch (error) {
                    if (error instanceof TitanBotError) {
                        logger.debug(`Verification config validation error: ${error.message}`);
                    } else {
                        logger.error('Unexpected verification dashboard error:', error);
                    }

                    const errorMessage =
                        error instanceof TitanBotError
                            ? error.userMessage || t(lang, 'wolf.cmd.verification.admin.dashboard.errProcessing')
                            : t(lang, 'wolf.cmd.verification.admin.dashboard.errUpdating');

                    if (!selectInteraction.replied && !selectInteraction.deferred) {
                        await selectInteraction.deferUpdate().catch(() => {});
                    }

                    await selectInteraction
                        .followUp({
                            embeds: [errorEmbed(t(lang, 'wolf.cmd.verification.admin.dashboard.errTitle'), errorMessage)],
                            flags: MessageFlags.Ephemeral,
                        })
                        .catch(() => {});
                }
            });

            // ── Button collector for toggle ──────────────────────────────────
            const btnCollector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.Button,
                filter: i =>
                    i.user.id === interaction.user.id &&
                    i.customId === `verif_cfg_toggle_${guildId}`,
                time: 600_000,
            });

            btnCollector.on('collect', async btnInteraction => {
                try {
                    await btnInteraction.deferUpdate().catch(() => null);
                } catch (err) {
                    logger.debug('Button interaction already expired:', err.message);
                    return;
                }
                
                const wasEnabled = cfg.enabled !== false;
                const autoVerifyEnabled = Boolean(guildConfig.verification?.autoVerify?.enabled);

                // Prevent enabling Verification if AutoVerify is enabled
                if (!wasEnabled && autoVerifyEnabled) {
                    await btnInteraction.followUp({
                        embeds: [errorEmbed(
                            t(lang, 'wolf.cmd.verification.admin.dashboard.errCannotEnableTitle'),
                            t(lang, 'wolf.cmd.verification.admin.dashboard.errCannotEnableDesc')
                        )],
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }

                cfg.enabled = !wasEnabled;

                // Disabling — remove the live panel message from the channel
                if (!cfg.enabled && cfg.channelId && cfg.messageId) {
                    const channel = interaction.guild.channels.cache.get(cfg.channelId);
                    if (channel) {
                        try {
                            const msg = await channel.messages.fetch(cfg.messageId).catch(() => null);
                            if (msg) await msg.delete();
                        } catch {
                            // already gone
                        }
                    }
                }

                // Re-enabling — re-post the verification panel in the configured channel
                if (cfg.enabled && cfg.channelId) {
                    const channel = interaction.guild.channels.cache.get(cfg.channelId);
                    if (channel) {
                        try {
                            const verifyEmbed = new EmbedBuilder()
                                .setTitle(t(lang, 'wolf.cmd.verification.admin.livePanelTitle'))
                                .setDescription(cfg.message || botConfig.verification.defaultMessage)
                                .setColor(getColor('success'));

                            const verifyButton = new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setCustomId('verify_user')
                                    .setLabel(cfg.buttonText || t(lang, 'wolf.cmd.verification.admin.livePanelDefaultButtonText'))
                                    .setStyle(ButtonStyle.Success)
                                    .setEmoji('✅'),
                            );

                            const newMsg = await channel.send({ embeds: [verifyEmbed], components: [verifyButton] });
                            cfg.messageId = newMsg.id;
                        } catch (error) {
                            logger.warn('Could not re-post verification panel on re-enable:', error.message);
                        }
                    }
                }

                const latestConfig = await getGuildConfig(client, guildId);
                latestConfig.verification = cfg;
                await setGuildConfig(client, guildId, latestConfig);

                await btnInteraction.followUp({
                    embeds: [
                        successEmbed(
                            t(lang, 'wolf.cmd.verification.admin.dashboard.statusUpdatedTitle'),
                            t(lang, 'wolf.cmd.verification.admin.dashboard.statusUpdatedDesc', { status: cfg.enabled ? t(lang, 'wolf.cmd.verification.admin.dashboard.enabled') : t(lang, 'wolf.cmd.verification.admin.dashboard.disabled') }),
                        ),
                    ],
                    flags: MessageFlags.Ephemeral,
                });

                await refreshDashboard(interaction, cfg, guildId, client, lang);
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    btnCollector.stop();
                    try {
                        await InteractionHelper.safeEditReply(interaction, {
                            embeds: [
                                new EmbedBuilder()
                                    .setTitle(t(lang, 'wolf.cmd.verification.admin.dashboard.timeoutTitle'))
                                    .setDescription(t(lang, 'wolf.cmd.verification.admin.dashboard.timeoutDesc'))
                                    .setColor(getColor('error'))
                            ],
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
            logger.error('Unexpected error in verification_dashboard:', error);
            throw new TitanBotError(
                `Verification dashboard failed: ${error.message}`,
                ErrorTypes.UNKNOWN,
                'Failed to open the verification dashboard.',
            );
        }
    },
};

// ─── Change Verification Channel ─────────────────────────────────────────────

async function handleChannel(selectInteraction, rootInteraction, cfg, guildId, client, lang) {
    await selectInteraction.deferUpdate();

    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('verif_cfg_channel')
        .setPlaceholder(t(lang, 'wolf.cmd.verification.admin.dashboard.actionChanPlaceholder'))
        .addChannelTypes(ChannelType.GuildText)
        .setMaxValues(1);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle(t(lang, 'wolf.cmd.verification.admin.dashboard.actionChanTitle'))
                .setDescription(
                    t(lang, 'wolf.cmd.verification.admin.dashboard.actionChanDesc', { current: cfg.channelId ? `<#${cfg.channelId}>` : t(lang, 'wolf.cmd.verification.admin.dashboard.notSet') }),
                )
                .setColor(getColor('info')),
        ],
        components: [new ActionRowBuilder().addComponents(channelSelect)],
        flags: MessageFlags.Ephemeral,
    });

    const chanCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'verif_cfg_channel',
        time: 60_000,
        max: 1,
    });

    chanCollector.on('collect', async chanInteraction => {
        await chanInteraction.deferUpdate();
        const newChannel = chanInteraction.channels.first();

        if (!botHasPermission(newChannel, ['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
            await chanInteraction.followUp({
                embeds: [
                    errorEmbed(
                        t(lang, 'wolf.cmd.verification.admin.dashboard.errTitle'),
                        t(lang, 'wolf.cmd.verification.admin.channelPermsError'),
                    ),
                ],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        // Delete old panel if it exists
        if (cfg.channelId && cfg.messageId) {
            const oldChannel = rootInteraction.guild.channels.cache.get(cfg.channelId);
            if (oldChannel) {
                try {
                    const oldMsg = await oldChannel.messages.fetch(cfg.messageId).catch(() => null);
                    if (oldMsg) await oldMsg.delete();
                } catch {
                    // already gone
                }
            }
        }

        // Post new panel in the new channel (only if system is enabled)
        if (cfg.enabled !== false) {
            try {
                const verifyEmbed = new EmbedBuilder()
                    .setTitle(t(lang, 'wolf.cmd.verification.admin.livePanelTitle'))
                    .setDescription(cfg.message || botConfig.verification.defaultMessage)
                    .setColor(getColor('success'));

                const verifyButton = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('verify_user')
                        .setLabel(cfg.buttonText || t(lang, 'wolf.cmd.verification.admin.livePanelDefaultButtonText'))
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('✅'),
                );

                const newMsg = await newChannel.send({ embeds: [verifyEmbed], components: [verifyButton] });
                cfg.messageId = newMsg.id;
            } catch (error) {
                logger.warn('Could not post verification panel in new channel:', error.message);
            }
        }

        cfg.channelId = newChannel.id;
        const latestConfig = await getGuildConfig(client, guildId);
        latestConfig.verification = cfg;
        await setGuildConfig(client, guildId, latestConfig);

        await chanInteraction.followUp({
            embeds: [successEmbed(
                t(lang, 'wolf.cmd.verification.admin.dashboard.actionChanSuccessTitle'),
                t(lang, 'wolf.cmd.verification.admin.dashboard.actionChanSuccessDesc', { channel: `${newChannel}` })
            )],
            flags: MessageFlags.Ephemeral,
        });

        await refreshDashboard(rootInteraction, cfg, guildId, client, lang);
    });

    chanCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            selectInteraction
                .followUp({
                    embeds: [errorEmbed(
                        t(lang, 'wolf.cmd.verification.admin.dashboard.actionChanTimeoutTitle'),
                        t(lang, 'wolf.cmd.verification.admin.dashboard.actionChanTimeoutDesc')
                    )],
                    flags: MessageFlags.Ephemeral,
                })
                .catch(() => {});
        }
    });
}

// ─── Change Verified Role ─────────────────────────────────────────────────────

async function handleRole(selectInteraction, rootInteraction, cfg, guildId, client, lang) {
    await selectInteraction.deferUpdate();

    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('verif_cfg_role')
        .setPlaceholder(t(lang, 'wolf.cmd.verification.admin.dashboard.actionRolePlaceholder'))
        .setMaxValues(1);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle(t(lang, 'wolf.cmd.verification.admin.dashboard.actionRoleTitle'))
                .setDescription(
                    t(lang, 'wolf.cmd.verification.admin.dashboard.actionRoleDesc', { current: cfg.roleId ? `<@&${cfg.roleId}>` : t(lang, 'wolf.cmd.verification.admin.dashboard.notSet') }),
                )
                .setColor(getColor('info')),
        ],
        components: [new ActionRowBuilder().addComponents(roleSelect)],
        flags: MessageFlags.Ephemeral,
    });

    const roleCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.RoleSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'verif_cfg_role',
        time: 60_000,
        max: 1,
    });

    roleCollector.on('collect', async roleInteraction => {
        await roleInteraction.deferUpdate();
        const role = roleInteraction.roles.first();
        const guild = rootInteraction.guild;
        const botMember = guild.members.me;

        if (role.id === guild.id || role.managed) {
            await roleInteraction.followUp({
                embeds: [
                    errorEmbed(
                        t(lang, 'wolf.cmd.verification.admin.dashboard.errTitle'),
                        t(lang, 'wolf.cmd.verification.admin.invalidRoleError'),
                    ),
                ],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        if (role.position >= botMember.roles.highest.position) {
            await roleInteraction.followUp({
                embeds: [
                    errorEmbed(
                        t(lang, 'wolf.cmd.verification.admin.dashboard.errTitle'),
                        t(lang, 'wolf.cmd.verification.admin.roleHierarchyError'),
                    ),
                ],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        cfg.roleId = role.id;
        const latestConfig = await getGuildConfig(client, guildId);
        latestConfig.verification = cfg;
        await setGuildConfig(client, guildId, latestConfig);

        await roleInteraction.followUp({
            embeds: [successEmbed(
                t(lang, 'wolf.cmd.verification.admin.dashboard.actionRoleSuccessTitle'),
                t(lang, 'wolf.cmd.verification.admin.dashboard.actionRoleSuccessDesc', { role: `${role}` })
            )],
            flags: MessageFlags.Ephemeral,
        });

        await refreshDashboard(rootInteraction, cfg, guildId, client, lang);
    });

    roleCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            selectInteraction
                .followUp({
                    embeds: [errorEmbed(
                        t(lang, 'wolf.cmd.verification.admin.dashboard.actionRoleTimeoutTitle'),
                        t(lang, 'wolf.cmd.verification.admin.dashboard.actionRoleTimeoutDesc')
                    )],
                    flags: MessageFlags.Ephemeral,
                })
                .catch(() => {});
        }
    });
}

// ─── Edit Verification Message ────────────────────────────────────────────────

async function handleMessage(selectInteraction, rootInteraction, cfg, guildId, client, lang) {
    try {
        const modal = new ModalBuilder()
            .setCustomId('verif_cfg_message')
            .setTitle(t(lang, 'wolf.cmd.verification.admin.dashboard.actionMsgModalTitle'))
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('message_input')
                        .setLabel(t(lang, 'wolf.cmd.verification.admin.dashboard.actionMsgInputLabel'))
                        .setStyle(TextInputStyle.Paragraph)
                        .setValue(cfg.message || botConfig.verification.defaultMessage)
                        .setMaxLength(2000)
                        .setMinLength(1)
                        .setRequired(true),
                ),
            );

        await selectInteraction.showModal(modal);

        const submitted = await selectInteraction
            .awaitModalSubmit({
                filter: i =>
                    i.customId === 'verif_cfg_message' && i.user.id === selectInteraction.user.id,
                time: 120_000,
            })
            .catch(() => null);

        if (!submitted) return;

        cfg.message = submitted.fields.getTextInputValue('message_input').trim();

        const latestConfig = await getGuildConfig(client, guildId);
        latestConfig.verification = cfg;
        await setGuildConfig(client, guildId, latestConfig);

        await updateLivePanel(rootInteraction.guild, cfg, lang);

        await submitted.reply({
            embeds: [successEmbed(
                t(lang, 'wolf.cmd.verification.admin.dashboard.actionMsgSuccessTitle'),
                t(lang, 'wolf.cmd.verification.admin.dashboard.actionMsgSuccessDesc')
            )],
            flags: MessageFlags.Ephemeral,
        });

        await refreshDashboard(rootInteraction, cfg, guildId, client, lang);
    } catch (error) {
        logger.error('Error in handleMessage:', error);
        // Silently fail - modal display failed, user can try again
    }
}

// ─── Edit Button Text ─────────────────────────────────────────────────────────

async function handleButtonText(selectInteraction, rootInteraction, cfg, guildId, client, lang) {
    try {
        const modal = new ModalBuilder()
            .setCustomId('verif_cfg_button_text')
            .setTitle(t(lang, 'wolf.cmd.verification.admin.dashboard.actionBtnModalTitle'))
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('button_text_input')
                        .setLabel(t(lang, 'wolf.cmd.verification.admin.dashboard.actionBtnInputLabel'))
                        .setStyle(TextInputStyle.Short)
                        .setValue(cfg.buttonText || botConfig.verification.defaultButtonText)
                        .setMaxLength(80)
                        .setMinLength(1)
                        .setRequired(true),
                ),
            );

        await selectInteraction.showModal(modal);

        const submitted = await selectInteraction
            .awaitModalSubmit({
                filter: i =>
                    i.customId === 'verif_cfg_button_text' && i.user.id === selectInteraction.user.id,
                time: 120_000,
            })
            .catch(() => null);

        if (!submitted) return;

        cfg.buttonText = submitted.fields.getTextInputValue('button_text_input').trim();

        const latestConfig = await getGuildConfig(client, guildId);
        latestConfig.verification = cfg;
        await setGuildConfig(client, guildId, latestConfig);

        await updateLivePanel(rootInteraction.guild, cfg, lang);

        await submitted.reply({
            embeds: [successEmbed(
                t(lang, 'wolf.cmd.verification.admin.dashboard.actionBtnSuccessTitle'),
                t(lang, 'wolf.cmd.verification.admin.dashboard.actionBtnSuccessDesc', { text: cfg.buttonText })
            )],
            flags: MessageFlags.Ephemeral,
        });

        await refreshDashboard(rootInteraction, cfg, guildId, client, lang);
    } catch (error) {
        logger.error('Error in handleButtonText:', error);
        // Silently fail - modal display failed, user can try again
    }
}
