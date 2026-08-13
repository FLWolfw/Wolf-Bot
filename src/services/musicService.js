import { Player } from 'discord-player';
import { DefaultExtractors } from '@discord-player/extractor';
import { YouTubeDlpExtractor } from 'discord-player-youtubedlp';
import { logger } from '../utils/logger.js';
import { t } from './i18n.js';

let _player = null;

export function getPlayer() {
  return _player;
}

function parseCookiesToHeader(netscapeContent) {
  if (!netscapeContent) return null;
  try {
    return netscapeContent
      .split('\n')
      .filter(line => line.trim() && !line.startsWith('#') && line.includes('\t'))
      .map(line => {
        const parts = line.split('\t');
        if (parts.length >= 7) {
          const name = parts[5]?.trim();
          const value = parts[6]?.trim();
          if (name && value) return `${name}=${value}`;
        }
        return null;
      })
      .filter(Boolean)
      .join('; ');
  } catch (e) {
    logger.warn('musicService: failed to parse YOUTUBE_COOKIE', { error: e?.message });
    return null;
  }
}

/**
 * Discord Player music service.
 * YouTube streaming uses yt-dlp + FFmpeg; Spotify/SoundCloud/Apple Music
 * continue to use Discord Player's standard extractors.
 */
export async function initMusic(client) {
  if (_player) return _player;

  const player = new Player(client);

  try {
    await player.extractors.loadMulti(DefaultExtractors);
    logger.info('musicService: DefaultExtractors loaded');
  } catch (err) {
    logger.error('musicService: failed to load DefaultExtractors', { error: err?.message });
  }

  const rawCookie = process.env.YOUTUBE_COOKIE || null;
  const cookieHeader = rawCookie ? parseCookiesToHeader(rawCookie) : null;

  if (cookieHeader) {
    logger.info(`musicService: YOUTUBE_COOKIE parsed — ${cookieHeader.split(';').length} cookies`);
  } else {
    logger.warn('musicService: YOUTUBE_COOKIE not set — yt-dlp will run anonymously');
  }

  try {
    await player.extractors.register(YouTubeDlpExtractor, {
      agent: cookieHeader ? { cookiesHeader: cookieHeader } : undefined,
      searchLimit: 3,
      playlistSearchLimit: 200,
      relatedLimit: 5,
      enableProtocols: true,
      searchTimeoutMs: 6000,
      videoTimeoutMs: 7000,
      playlistTimeoutMs: 25000,
      ytdlpTimeoutMs: 25000,
      infoCacheTtlMs: 120000,
      debug: false,
    });
    logger.info('musicService: YouTubeDlpExtractor registered (yt-dlp + FFmpeg)');
  } catch (err) {
    logger.error('musicService: failed to register YouTubeDlpExtractor', {
      error: err?.message,
      stack: err?.stack?.slice(0, 500),
    });
  }

  logger.info(`musicService: ${player.extractors.size} extractors active`);

  if (player.extractors.size === 0) {
    logger.warn('musicService: no extractors registered — /music play will not work');
  }

  const lang = (queue) => queue.metadata?.lang === 'en' ? 'en' : 'es';

  player.events.on('playerStart', (queue, track) => {
    const channel = queue.metadata?.channel;
    if (!channel) return;
    const L = lang(queue);
    channel.send({
      embeds: [{
        color: 0x7b6cff,
        author: { name: t(L, 'wolf.music.nowPlayingHeader') },
        title: track.title?.slice(0, 250) || 'Track',
        url: track.url,
        description: `**${track.author}** · \`${track.duration}\``,
        thumbnail: track.thumbnail ? { url: track.thumbnail } : undefined,
        footer: { text: t(L, 'wolf.music.nowPlayingFooter', { user: track.requestedBy?.tag || 'anonymous' }) },
      }],
    }).catch(() => {});
  });

  player.events.on('audioTracksAdd', (queue, tracks) => {
    const L = lang(queue);
    queue.metadata?.channel?.send({
      embeds: [{
        color: 0x36d6c3,
        title: t(L, 'wolf.music.playlistFull'),
        description: t(L, 'wolf.music.playlistTracks', { count: tracks.length }),
      }],
    }).catch(() => {});
  });

  player.events.on('emptyQueue', (queue) => {
    const L = lang(queue);
    queue.metadata?.channel?.send({
      embeds: [{
        color: 0x5b6072,
        description: t(L, 'wolf.music.queueEnded'),
      }],
    }).catch(() => {});
  });

  player.events.on('playerError', (queue, err, track) => {
    const errMsg = String(err?.message || err);
    logger.error('music playerError', { track: track?.title, error: errMsg, stack: err?.stack?.slice(0, 500) });
    const L = lang(queue);
    queue.metadata?.channel?.send({
      embeds: [{
        color: 0xef4444,
        title: t(L, 'wolf.music.errorTitle'),
        description: `❌ \`${track?.title?.slice(0, 80) || 'Pista'}\`\n\`\`\`${errMsg.slice(0, 500)}\`\`\``,
      }],
    }).catch(() => {});
  });

  player.events.on('error', (queue, err) => {
    logger.error('music queue error', { error: err?.message, stack: err?.stack?.slice(0, 500) });
    const L = lang(queue);
    queue.metadata?.channel?.send({
      embeds: [{
        color: 0xef4444,
        title: t(L, 'wolf.music.errorTitle'),
        description: '```' + String(err?.message || err).slice(0, 600) + '```',
      }],
    }).catch(() => {});
  });

  _player = player;
  logger.info('Music player ready (YouTube/Spotify/SoundCloud)');
  return player;
}
