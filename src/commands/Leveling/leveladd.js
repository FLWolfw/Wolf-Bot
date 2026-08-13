import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { checkUserPermissions } from '../../utils/permissionGuard.js';
import { addLevels, getLevelingConfig } from '../../services/leveling.js';
import { createEmbed } from '../../utils/embeds.js';
import { t, pickLanguage } from '../../services/i18n.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
  data: new SlashCommandBuilder()
    .setName('leveladd')
    .setDescription('Add levels to a user')
    .addUserOption((option) => option
      .setName('user')
      .setDescription('The user to add levels to')
      .setRequired(true))
    .addIntegerOption((option) => option
      .setName('levels')
      .setDescription('Number of levels to add')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(1000))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),
  category: 'Leveling',

  async execute(interaction, config, client) {
    const lang = pickLanguage(config, interaction.guild);
    try {
      await InteractionHelper.safeDefer(interaction);

      const hasPermission = await checkUserPermissions(
        interaction,
        PermissionFlagsBits.ManageGuild,
        t(lang, 'wolf.cmd.leveling.admin.missingPermsDesc')
      );
      if (!hasPermission) return;

      const levelingConfig = await getLevelingConfig(client, interaction.guildId);
      if (!levelingConfig?.enabled) {
        await InteractionHelper.safeEditReply(interaction, {
          embeds: [new EmbedBuilder()
            .setColor('#f1c40f')
            .setDescription(t(lang, 'wolf.cmd.leveling.disabled'))],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const targetUser = interaction.options.getUser('user');
      const levelsToAdd = interaction.options.getInteger('levels');

      const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      if (!member) {
        throw new TitanBotError(
          `User ${targetUser.id} not found in this guild`,
          ErrorTypes.USER_INPUT,
          t(lang, 'wolf.cmd.leveling.userNotFound')
        );
      }

      const userData = await addLevels(client, interaction.guildId, targetUser.id, levelsToAdd);

      await InteractionHelper.safeEditReply(interaction, {
        embeds: [createEmbed({
          title: t(lang, 'wolf.cmd.leveling.admin.leveladd.successTitle'),
          description: t(lang, 'wolf.cmd.leveling.admin.leveladd.successDesc', {
            levels: levelsToAdd,
            user: targetUser.tag,
            level: userData.level,
          }),
          color: 'success',
        })],
      });

      logger.info(`[ADMIN] User ${interaction.user.tag} added ${levelsToAdd} levels to ${targetUser.tag} in guild ${interaction.guildId}`);
    } catch (error) {
      logger.error('LevelAdd command error:', error);
      await handleInteractionError(interaction, error, {
        type: 'command',
        commandName: 'leveladd',
      });
    }
  },
};
