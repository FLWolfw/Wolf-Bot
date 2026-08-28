import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import {
  createSpotifyAuthUrl, getSession, getProfile, getDevices, getPlaylists, getPlayback,
  play, pause, resume, next, previous, setShuffle, setRepeat, disconnect,
} from '../services/spotifyService.js';

const data = new SlashCommandBuilder()
  .setName('spotify')
  .setDescription('Controla tu cuenta de Spotify')
  .addSubcommand(s => s.setName('connect').setDescription('Conecta tu cuenta de Spotify'))
  .addSubcommand(s => s.setName('status').setDescription('Muestra tu cuenta conectada'))
  .addSubcommand(s => s.setName('playlists').setDescription('Muestra tus playlists'))
  .addSubcommand(s => s.setName('devices').setDescription('Muestra tus dispositivos Spotify'))
  .addSubcommand(s => s.setName('now').setDescription('Muestra lo que estás escuchando'))
  .addSubcommand(s => s.setName('play').setDescription('Reproduce una playlist por ID').addStringOption(o => o.setName('playlist_id').setDescription('ID de la playlist').setRequired(true)))
  .addSubcommand(s => s.setName('pause').setDescription('Pausa Spotify'))
  .addSubcommand(s => s.setName('resume').setDescription('Reanuda Spotify'))
  .addSubcommand(s => s.setName('next').setDescription('Siguiente canción'))
  .addSubcommand(s => s.setName('previous').setDescription('Canción anterior'))
  .addSubcommand(s => s.setName('shuffle').setDescription('Activa o desactiva shuffle').addBooleanOption(o => o.setName('enabled').setDescription('Activado').setRequired(true)))
  .addSubcommand(s => s.setName('repeat').setDescription('Modo repeat').addStringOption(o => o.setName('mode').setDescription('off, track o context').setRequired(true).addChoices(
    { name: 'Off', value: 'off' }, { name: 'Track', value: 'track' }, { name: 'Playlist', value: 'context' },
  )))
  .addSubcommand(s => s.setName('disconnect').setDescription('Desconecta tu cuenta de Spotify'));

function errorMessage(err) {
  return err?.response?.data?.error?.message || err?.response?.data?.error_description || err?.message || 'Error desconocido';
}

function currentText(item) {
  if (!item?.item) return 'No hay ninguna canción reproduciéndose.';
  const artists = item.item.artists?.map(a => a.name).join(', ') || 'Artista desconocido';
  return `**${item.item.name}** — ${artists}\n${item.is_playing ? '▶️ Reproduciendo' : '⏸️ Pausado'}`;
}

export default {
  data,
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    try {
      if (sub === 'connect') {
        const url = createSpotifyAuthUrl(userId);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel('🎵 Conectar Spotify').setStyle(ButtonStyle.Link).setURL(url),
        );
        return interaction.reply({ content: 'Conecta tu cuenta de Spotify:', components: [row], ephemeral: true });
      }

      if (sub === 'disconnect') {
        await disconnect(userId);
        return interaction.reply({ content: '✅ Tu cuenta de Spotify fue desconectada.', ephemeral: true });
      }

      const session = await getSession(userId);
      if (!session) return interaction.reply({ content: '❌ Primero usa `/spotify connect`.', ephemeral: true });

      if (sub === 'status') {
        const profile = await getProfile(userId);
        return interaction.reply({ content: `🟢 **Spotify conectado**\nCuenta: **${profile.display_name || profile.id}**\nPlan: **${profile.product || 'desconocido'}**`, ephemeral: true });
      }

      if (sub === 'playlists') {
        const result = await getPlaylists(userId, 50);
        const items = result.items || [];
        if (!items.length) return interaction.reply({ content: 'No encontré playlists en tu cuenta.', ephemeral: true });
        const lines = items.slice(0, 25).map((p, i) => `**${i + 1}. ${p.name}**\nID: \`${p.id}\` • ${p.items?.total ?? p.tracks?.total ?? 0} canciones`);
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🎵 Tus playlists').setDescription(lines.join('\n\n'))], ephemeral: true });
      }

      if (sub === 'devices') {
        const result = await getDevices(userId);
        const devices = result.devices || [];
        if (!devices.length) return interaction.reply({ content: 'No hay dispositivos Spotify activos. Abre Spotify en un dispositivo e inténtalo otra vez.', ephemeral: true });
        const lines = devices.map(d => `${d.is_active ? '🟢' : '⚪'} **${d.name}** — ${d.type} — ID: \`${d.id}\``);
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🎧 Dispositivos Spotify').setDescription(lines.join('\n'))], ephemeral: true });
      }

      if (sub === 'now') {
        const playback = await getPlayback(userId);
        return interaction.reply({ content: currentText(playback), ephemeral: true });
      }

      const devices = await getDevices(userId);
      const active = devices.devices?.find(d => d.is_active) || devices.devices?.[0];
      const deviceId = active?.id;
      if (!deviceId && ['play', 'pause', 'resume', 'next', 'previous', 'shuffle', 'repeat'].includes(sub)) {
        return interaction.reply({ content: '❌ No encontré un dispositivo Spotify disponible. Abre Spotify primero.', ephemeral: true });
      }

      if (sub === 'play') {
        const id = interaction.options.getString('playlist_id', true);
        await play(userId, deviceId, `spotify:playlist:${id}`);
        return interaction.reply(`▶️ Reproduciendo la playlist **${id}** en **${active.name}**.`);
      }
      if (sub === 'pause') { await pause(userId, deviceId); return interaction.reply('⏸️ Spotify pausado.'); }
      if (sub === 'resume') { await resume(userId, deviceId); return interaction.reply('▶️ Spotify reanudado.'); }
      if (sub === 'next') { await next(userId, deviceId); return interaction.reply('⏭️ Siguiente canción.'); }
      if (sub === 'previous') { await previous(userId, deviceId); return interaction.reply('⏮️ Canción anterior.'); }
      if (sub === 'shuffle') { const enabled = interaction.options.getBoolean('enabled', true); await setShuffle(userId, enabled, deviceId); return interaction.reply(`🔀 Shuffle **${enabled ? 'activado' : 'desactivado'}**.`); }
      if (sub === 'repeat') { const mode = interaction.options.getString('mode', true); await setRepeat(userId, mode, deviceId); return interaction.reply(`🔁 Repeat: **${mode}**.`); }
    } catch (err) {
      console.error('[Spotify]', err);
      const message = `❌ Spotify error: ${errorMessage(err)}`;
      if (interaction.replied || interaction.deferred) return interaction.followUp({ content: message, ephemeral: true });
      return interaction.reply({ content: message, ephemeral: true });
    }
  },
};
