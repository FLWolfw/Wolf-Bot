import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { errorEmbed, successEmbed, infoEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { getFromDb, setInDb } from '../../utils/database.js';
import { sanitizeInput } from '../../utils/sanitization.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { t, pickLanguage } from '../../services/i18n.js';

function getUserNotesKey(guildId, userId) {
    return `moderation_user_notes_${guildId}_${userId}`;
}

export default {
    data: new SlashCommandBuilder()
        .setName("usernotes")
        .setDescription("Manage user notes for moderation purposes")
        .addSubcommand(subcommand =>
            subcommand
                .setName("add")
                .setDescription("Add a note to a user")
                .addUserOption(option =>
                    option.setName("target").setDescription("The user to add a note for").setRequired(true)
                )
                .addStringOption(option =>
                    option.setName("note").setDescription("The note to add").setRequired(true)
                )
                .addStringOption(option =>
                    option.setName("type").setDescription("Type of note")
                        .addChoices(
                            { name: "Warning", value: "warning" },
                            { name: "Positive", value: "positive" },
                            { name: "Neutral", value: "neutral" },
                            { name: "Alert", value: "alert" }
                        ).setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName("view")
                .setDescription("View notes for a user")
                .addUserOption(option =>
                    option.setName("target").setDescription("The user to view notes for").setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName("remove")
                .setDescription("Remove a specific note from a user")
                .addUserOption(option =>
                    option.setName("target").setDescription("The user to remove a note from").setRequired(true)
                )
                .addIntegerOption(option =>
                    option.setName("index").setDescription("The index of the note to remove").setRequired(true).setMinValue(1)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName("clear")
                .setDescription("Clear all notes for a user")
                .addUserOption(option =>
                    option.setName("target").setDescription("The user to clear notes for").setRequired(true)
                )
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    category: "moderation",

    async execute(interaction, config, client) {
        const lang = pickLanguage(config, interaction.guild);

        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return InteractionHelper.safeReply(interaction, {
                embeds: [
                    errorEmbed(
                        t(lang, 'wolf.cmd.mod.common.permDenied'),
                        t(lang, 'wolf.cmd.mod.usernotes.permDenied')
                    ),
                ],
            });
        }

        const subcommand = interaction.options.getSubcommand();
        const targetUser = interaction.options.getUser("target");
        const guildId = interaction.guild.id;

        if (!['view', 'remove', 'clear', 'add'].includes(subcommand)) {
            return InteractionHelper.safeReply(interaction, {
                embeds: [
                    errorEmbed(
                        t(lang, 'wolf.cmd.mod.common.permDenied'),
                        t(lang, 'wolf.cmd.mod.usernotes.invalidSub')
                    ),
                ],
            });
        }

        let notes = [];
        if (targetUser) {
            const notesKey = getUserNotesKey(guildId, targetUser.id);
            notes = await getFromDb(notesKey, []);
        }

        try {
            switch (subcommand) {
                case "add":
                    return await handleAddNote(interaction, targetUser, notes, guildId, lang);
                case "view":
                    return await handleViewNotes(interaction, targetUser, notes, lang);
                case "remove":
                    return await handleRemoveNote(interaction, targetUser, notes, guildId, lang);
                case "clear":
                    return await handleClearNotes(interaction, targetUser, notes, guildId, lang);
                default:
                    return InteractionHelper.safeReply(interaction, {
                        embeds: [errorEmbed(t(lang, 'wolf.cmd.mod.usernotes.invalidSub'))],
                    });
            }
        } catch (error) {
            logger.error(`Error in usernotes command (${subcommand}):`, error);
            return InteractionHelper.safeReply(interaction, {
                embeds: [
                    errorEmbed(
                        "System Error",
                        t(lang, 'wolf.cmd.mod.usernotes.sysError')
                    ),
                ],
                flags: MessageFlags.Ephemeral
            });
        }
    }
};

async function handleAddNote(interaction, targetUser, notes, guildId, lang) {
    let note = interaction.options.getString("note").trim();
    const type = interaction.options.getString("type") || "neutral";

    if (note.length > 1000) {
        return InteractionHelper.safeReply(interaction, {
            embeds: [
                errorEmbed(
                    t(lang, 'wolf.cmd.mod.usernotes.add.tooLongTitle'),
                    t(lang, 'wolf.cmd.mod.usernotes.add.tooLong')
                ),
            ],
        });
    }

    if (note.length === 0) {
        return InteractionHelper.safeReply(interaction, {
            embeds: [
                errorEmbed(
                    t(lang, 'wolf.cmd.mod.usernotes.add.emptyTitle'),
                    t(lang, 'wolf.cmd.mod.usernotes.add.empty')
                ),
            ],
        });
    }

    note = sanitizeInput(note);

    const noteData = {
        id: Date.now(),
        content: note,
        type,
        author: interaction.user.tag,
        authorId: interaction.user.id,
        timestamp: new Date().toISOString()
    };

    notes.push(noteData);
    await setInDb(getUserNotesKey(guildId, targetUser.id), notes);

    const typeInfo = getNoteTypeInfo(type);

    return InteractionHelper.safeReply(interaction, {
        embeds: [
            successEmbed(
                t(lang, 'wolf.cmd.mod.usernotes.add.successTitle', { emoji: typeInfo.emoji }),
                t(lang, 'wolf.cmd.mod.usernotes.add.successDesc', {
                    type,
                    user: targetUser.tag,
                    note,
                    mod: interaction.user.tag,
                    count: notes.length
                })
            )
        ]
    });
}

async function handleViewNotes(interaction, targetUser, notes, lang) {
    if (notes.length === 0) {
        return InteractionHelper.safeReply(interaction, {
            embeds: [
                infoEmbed(
                    t(lang, 'wolf.cmd.mod.usernotes.view.noNotesTitle'),
                    t(lang, 'wolf.cmd.mod.usernotes.view.noNotesDesc', { user: targetUser.tag })
                ),
            ],
        });
    }

    const sortedNotes = [...notes].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    let description = t(lang, 'wolf.cmd.mod.usernotes.view.header', { user: targetUser.tag, id: targetUser.id });

    sortedNotes.forEach((note, index) => {
        const typeInfo = getNoteTypeInfo(note.type);
        const date = new Date(note.timestamp).toLocaleDateString();
        description += `${typeInfo.emoji} **Note #${index + 1}** (${note.type}) - ${date}\n`;
        description += `> ${note.content}\n`;
        description += `${t(lang, 'wolf.cmd.mod.usernotes.view.addedBy', { author: note.author })}\n\n`;
    });

    if (description.length > 4000) {
        description = description.substring(0, 3900) + "\n... *(truncated)*";
    }

    return InteractionHelper.safeReply(interaction, {
        embeds: [
            infoEmbed(
                t(lang, 'wolf.cmd.mod.usernotes.view.title', { count: notes.length }),
                description
            )
        ]
    });
}

async function handleRemoveNote(interaction, targetUser, notes, guildId, lang) {
    const index = interaction.options.getInteger("index") - 1;

    if (index < 0 || index >= notes.length) {
        return InteractionHelper.safeReply(interaction, {
            embeds: [
                errorEmbed(
                    t(lang, 'wolf.cmd.mod.usernotes.remove.invalidTitle'),
                    t(lang, 'wolf.cmd.mod.usernotes.remove.invalidDesc', { max: notes.length })
                ),
            ],
        });
    }

    const removedNote = notes[index];
    notes.splice(index, 1);
    await setInDb(getUserNotesKey(guildId, targetUser.id), notes);

    const typeInfo = getNoteTypeInfo(removedNote.type);

    return InteractionHelper.safeReply(interaction, {
        embeds: [
            successEmbed(
                t(lang, 'wolf.cmd.mod.usernotes.remove.successTitle', { emoji: typeInfo.emoji }),
                t(lang, 'wolf.cmd.mod.usernotes.remove.successDesc', {
                    num: index + 1,
                    user: targetUser.tag,
                    content: removedNote.content,
                    remaining: notes.length
                })
            )
        ]
    });
}

async function handleClearNotes(interaction, targetUser, notes, guildId, lang) {
    const noteCount = notes.length;

    if (noteCount === 0) {
        return InteractionHelper.safeReply(interaction, {
            embeds: [
                infoEmbed(
                    t(lang, 'wolf.cmd.mod.usernotes.clear.noNotesTitle'),
                    t(lang, 'wolf.cmd.mod.usernotes.clear.noNotesDesc', { user: targetUser.tag })
                ),
            ],
        });
    }

    notes.length = 0;
    await setInDb(getUserNotesKey(guildId, targetUser.id), notes);

    return InteractionHelper.safeReply(interaction, {
        embeds: [
            successEmbed(
                t(lang, 'wolf.cmd.mod.usernotes.clear.successTitle'),
                t(lang, 'wolf.cmd.mod.usernotes.clear.successDesc', { count: noteCount, user: targetUser.tag })
            )
        ]
    });
}

function getNoteTypeInfo(type) {
    const types = {
        warning: { emoji: "⚠️", color: "#FF6B6B" },
        positive: { emoji: "✅", color: "#51CF66" },
        neutral: { emoji: "📝", color: "#74C0FC" },
        alert: { emoji: "🚨", color: "#FFD43B" }
    };
    return types[type] || types.neutral;
}
