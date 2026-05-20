




import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { getUserLevelData, getLevelingConfig, getXpForLevel } from '../../services/leveling.js';
import { t, pickLanguage } from '../../services/i18n.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
export default {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription("Check your or another user's rank and level")
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('The user to check the rank of')
        .setRequired(false)
    )
    .setDMPermission(false),
  category: 'Leveling',

  





  async execute(interaction, config, client) {
    const lang = pickLanguage(config, interaction.guild);
    try {
      await InteractionHelper.safeDefer(interaction);

      const levelingConfig = await getLevelingConfig(client, interaction.guildId);
      if (!levelingConfig?.enabled) {
        await InteractionHelper.safeEditReply(interaction, {
          embeds: [new EmbedBuilder().setColor('#f1c40f').setDescription(t(lang, 'wolf.cmd.leveling.disabled'))],
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const targetUser = interaction.options.getUser('user') || interaction.user;
      const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

      if (!member) {
        throw new TitanBotError(
          `User ${targetUser.id} not found in guild`,
          ErrorTypes.USER_INPUT,
          t(lang, 'wolf.cmd.leveling.userNotFound'),
        );
      }

      const userData = await getUserLevelData(client, interaction.guildId, targetUser.id);
      const safeUserData = {
        level: userData?.level ?? 0,
        xp: userData?.xp ?? 0,
        totalXp: userData?.totalXp ?? 0
      };

      const xpNeeded = getXpForLevel(safeUserData.level + 1);
      const progress = xpNeeded > 0 ? Math.floor((safeUserData.xp / xpNeeded) * 100) : 0;
      const progressBar = createProgressBar(progress, 20);

      const embed = new EmbedBuilder()
        .setTitle(t(lang, 'wolf.cmd.leveling.rankTitle', { user: member.displayName }))
        .setThumbnail(member.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: t(lang, 'wolf.cmd.leveling.level'), value: safeUserData.level.toString(), inline: true },
          { name: t(lang, 'wolf.cmd.leveling.xp'), value: `${safeUserData.xp}/${xpNeeded}`, inline: true },
          { name: t(lang, 'wolf.cmd.leveling.totalXp'), value: safeUserData.totalXp.toString(), inline: true },
          { name: t(lang, 'wolf.cmd.leveling.progressTo', { level: safeUserData.level + 1 }), value: `${progressBar} ${progress}%` },
        )
        .setColor('#2ecc71')
        .setTimestamp();

      await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
      logger.debug(`Rank checked for user ${targetUser.id} in guild ${interaction.guildId}`);
    } catch (error) {
      logger.error('Rank command error:', error);
      await handleInteractionError(interaction, error, {
        type: 'command',
        commandName: 'rank'
      });
    }
  }
};







function createProgressBar(percentage, length = 10) {
  if (percentage < 0 || percentage > 100) {
    percentage = Math.max(0, Math.min(100, percentage));
  }
  const filled = Math.round((percentage / 100) * length);
  return '█'.repeat(filled) + '░'.repeat(length - filled);
}



