import { Player } from 'discord-player';
import { DefaultExtractors } from '@discord-player/extractor';
import { YoutubeiExtractor } from 'discord-player-youtubei';
import { logger } from '../utils/logger.js';
import { t } from './i18n.js';

let _player = null;

export function getPlayer() {
  return _player;
}

/**
 * Create and configure the discord-player instance.
 *
 * Sources (priority): YouTube (via youtubei.js + BotGuard), Spotify
 * metadata → resolved to YouTube audio, SoundCloud, Apple Music,
 * Attachments.
 *
 * YoutubeiExtractor is configured with innertubeClient: 'TV_EMBEDDED'
 * which avoids YouTube's bot-detection checks that block the default
 * WEB client. The bgutils-js + jsdom stack handles BotGuard challenges
 * automatically.
 */
export async function initMusic(client) {
  if (_player) return _player;

  // discord-player v7 — no ytdlOptions needed (we use youtubei, not ytdl)
  const player = new Player(client);

  // ── Load default extractors (Spotify, SoundCloud, Apple Music, etc.) ──
  try {
    await player.extractors.loadMulti(DefaultExtractors);
    logger.info('musicService: DefaultExtractors loaded');
  } catch (err) {
    logger.error('musicService: failed to load DefaultExtractors', { error: err?.message });
  }

  // ── YouTube via youtubei.js (discord-player-youtubei) ──
  // useClient: 'IOS' avoids YouTube's signature-decipher entirely
  // (the iOS client returns unsigned stream URLs). This sidesteps the
  // "Failed to extract signature decipher algorithm" error that
  // youtubei.js v14 hit when YouTube changed their web player format.
  // Falls back to ANDROID if IOS fails.
  try {
    await player.extractors.register(YoutubeiExtractor, {
      streamOptions: {
        useClient: 'IOS',
      },
    });
    logger.info('musicService: YoutubeiExtractor registered (stream client: IOS, no signature decipher)');
  } catch (err) {
    logger.warn('musicService: IOS client failed, retrying with ANDROID', { error: err?.message });
    try {
      await player.extractors.register(YoutubeiExtractor, {
        streamOptions: {
          useClient: 'ANDROID',
        },
      });
      logger.info('musicService: YoutubeiExtractor registered (ANDROID fallback)');
    } catch (err2) {
      logger.error('musicService: failed to register YoutubeiExtractor', { error: err2?.message });
    }
  }

  const registeredCount = player.extractors.size;
  logger.info(`musicService: ${registeredCount} extractors active`);

  if (registeredCount === 0) {
    logger.warn('musicService: no extractors registered — /music play will not work');
  }

  const lang = (queue) => queue.metadata?.lang === 'en' ? 'en' : 'es';

  // ── User-facing events ─────────────────────────────────────────
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

  player.events.on('playerError', (queue, err) => {
    logger.error('music playerError', { error: err?.message, stack: err?.stack?.slice(0, 500) });
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
