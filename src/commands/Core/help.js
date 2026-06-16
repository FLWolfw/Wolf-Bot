import {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} from "discord.js";
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { createEmbed } from "../../utils/embeds.js";
import {
    createSelectMenu,
} from "../../utils/components.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { t, pickLanguage } from '../../services/i18n.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CATEGORY_SELECT_ID = "help-category-select";
const ALL_COMMANDS_ID = "help-all-commands";
const BUG_REPORT_BUTTON_ID = "help-bug-report";
const HELP_MENU_TIMEOUT_MS = 5 * 60 * 1000;

const CATEGORY_ICONS = {
    Core: "ℹ️",
    Moderation: "🛡️",
    Economy: "💰",
    Fun: "🎮",
    Music: "🎵",
    Leveling: "📊",
    Utility: "🔧",
    Ticket: "🎫",
    Welcome: "👋",
    Giveaway: "🎉",
    Counter: "🔢",
    Tools: "🛠️",
    Search: "🔍",
    Reaction_Roles: "🎭",
    Community: "👥",
    Birthday: "🎂",
    Config: "⚙️",
};





export async function createInitialHelpMenu(client, lang = 'es') {
    const commandsPath = path.join(__dirname, "../../commands");
    const categoryDirs = (
        await fs.readdir(commandsPath, { withFileTypes: true })
    )
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name)
        .sort();

    const options = [
        {
            label: t(lang, 'wolf.cmd.help.allCommands'),
            description: t(lang, 'wolf.cmd.help.allCommandsDesc'),
            value: ALL_COMMANDS_ID,
        },
        ...categoryDirs.map((category) => {
            const categoryName =
                category.charAt(0).toUpperCase() +
                category.slice(1).toLowerCase();
            const icon = CATEGORY_ICONS[categoryName] || "🔍";
            return {
                label: `${icon} ${categoryName}`,
                description: t(lang, 'wolf.cmd.help.categoryDesc', { name: categoryName }),
                value: category,
            };
        }),
    ];

    const botName = client?.user?.username || "Bot";
    const embed = createEmbed({
        title: t(lang, 'wolf.cmd.help.title', { bot: botName }),
        description: t(lang, 'wolf.cmd.help.description'),
        color: 'primary'
    });

    embed.addFields(
        {
            name: "🛡️ **Moderation**",
            value: "Server moderation, user management, and enforcement tools",
            inline: true
        },
        {
            name: "💰 **Economy**",
            value: "Currency system, shops, and virtual economy",
            inline: true
        },
        {
            name: "🎮 **Fun**",
            value: "Games, entertainment, and interactive commands",
            inline: true
        },
        {
            name: "🎵 **Music**",
            value: "Play songs, playlists, queue controls, volume, loop, and 24/7 mode",
            inline: true
        },
        {
            name: "📊 **Leveling**",
            value: "User levels, XP system, and progression tracking",
            inline: true
        },
        {
            name: "🎫 **Tickets**",
            value: "Support ticket system for server management",
            inline: true
        },
        {
            name: "🎉 **Giveaways**",
            value: "Automated giveaway management and distribution",
            inline: true
        },
        {
            name: "👋 **Welcome**",
            value: "Member welcome messages and onboarding",
            inline: true
        },
        {
            name: "🎂 **Birthdays**",
            value: "Birthday tracking and celebration features",
            inline: true
        },
        {
            name: "👥 **Community**",
            value: "Community tools, applications, and member engagement",
            inline: true
        },
        {
            name: "⚙️ **Config**",
            value: "Server and bot configuration management commands",
            inline: true
        },
        {
            name: "🔢 **Counter**",
            value: "Live counter channel setup and counter controls",
            inline: true
        },
        {
            name: "🎙️ **Join to Create**",
            value: "Dynamic voice channel creation and management",
            inline: true
        },
        {
            name: "🎭 **Reaction Roles**",
            value: "Self-assignable roles using reaction-role systems",
            inline: true
        },
        {
            name: "✅ **Verification**",
            value: "Member verification workflows and access gating",
            inline: true
        },
        {
            name: "🔧 **Utilities**",
            value: "Useful tools and server utilities",
            inline: true
        }
    );

    embed.setFooter({ text: t(lang, 'wolf.cmd.help.footer') });
    embed.setTimestamp();

    const bugReportButton = new ButtonBuilder()
        .setCustomId(BUG_REPORT_BUTTON_ID)
        .setLabel(t(lang, 'wolf.cmd.help.reportBug'))
        .setStyle(ButtonStyle.Danger);

    const components = [];
    const buttons = [bugReportButton];

    const supportInvite = (await import('../../config/bot.js')).botConfig.brand?.supportInvite;
    if (supportInvite) {
        buttons.push(
            new ButtonBuilder()
                .setLabel(t(lang, 'wolf.cmd.help.supportServer'))
                .setURL(supportInvite)
                .setStyle(ButtonStyle.Link),
        );
    }

    const selectRow = createSelectMenu(
        CATEGORY_SELECT_ID,
        t(lang, 'wolf.cmd.help.selectPlaceholder'),
        options,
    );

    components.push(new ActionRowBuilder().addComponents(buttons), selectRow);

    return { embeds: [embed], components };
}

export default {
    data: new SlashCommandBuilder()
        .setName("help")
        .setDescription("Displays the help menu with all available commands"),

    async execute(interaction, guildConfig, client) {
        const lang = pickLanguage(guildConfig, interaction.guild);
        await InteractionHelper.safeDefer(interaction);

        const { embeds, components } = await createInitialHelpMenu(client, lang);

        await InteractionHelper.safeEditReply(interaction, {
            embeds,
            components,
        });

        setTimeout(async () => {
            try {
                const closedEmbed = createEmbed({
                    title: t(lang, 'wolf.cmd.help.closedTitle'),
                    description: t(lang, 'wolf.cmd.help.closedDesc'),
                    color: "secondary",
                });

                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [closedEmbed],
                    components: [],
                });
            } catch (error) {
                /* timeout cleanup, ignore */
            }
        }, HELP_MENU_TIMEOUT_MS);
    },
};

