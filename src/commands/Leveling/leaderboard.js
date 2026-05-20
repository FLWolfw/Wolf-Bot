




import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { getLeaderboard, getLevelingConfig, getXpForLevel } from '../../services/leveling.js';
import { t, pickLanguage } from '../../services/i18n.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
export default {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription("Shows the server's level leaderboard")
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

      const leaderboard = await getLeaderboard(client, interaction.guildId, 10);

      if (leaderboard.length === 0) {
        throw new TitanBotError('No leaderboard data found', ErrorTypes.DATABASE, t(lang, 'wolf.cmd.leveling.lbEmpty'));
      }

      const embed = new EmbedBuilder()
        .setTitle(t(lang, 'wolf.cmd.leveling.lbTitle'))
        .setColor('#2ecc71')
        .setDescription(t(lang, 'wolf.cmd.leveling.lbDescription'))
        .setTimestamp();

      const leaderboardText = await Promise.all(
        leaderboard.map(async (user, index) => {
          try {
            const member = await interaction.guild.members.fetch(user.userId).catch(() => null);
            const userMention = member?.user.toString() || `<@${user.userId}>`;
            const xpForNextLevel = getXpForLevel(user.level + 1);

            let rankPrefix = `${index + 1}.`;
            if (index === 0) rankPrefix = '🥇';
            else if (index === 1) rankPrefix = '🥈';
            else if (index === 2) rankPrefix = '🥉';
            else rankPrefix = `**${index + 1}.**`;

            return t(lang, 'wolf.cmd.leveling.lbEntry', { rank: rankPrefix, user: userMention, level: user.level, xp: user.xp, next: xpForNextLevel });
          } catch {
            return `**${index + 1}.** Error loading user ${user.userId}`;
          }
        })
      );

      embed.addFields({ name: t(lang, 'wolf.cmd.leveling.lbRankings'), value: leaderboardText.join('\n') });

      await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
      logger.debug(`Leaderboard displayed for guild ${interaction.guildId}`);
    } catch (error) {
      logger.error('Leaderboard command error:', error);
      await handleInteractionError(interaction, error, {
        type: 'command',
        commandName: 'leaderboard'
      });
    }
  }
};



