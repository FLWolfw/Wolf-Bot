import { Player } from 'discord-player';
import { DefaultExtractors } from '@discord-player/extractor';
import { YoutubeiExtractor } from 'discord-player-youtubei';
import { createRequire } from 'module';
import { logger } from '../utils/logger.js';
import { t } from './i18n.js';

const require = createRequire(import.meta.url);

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

  // Log installed versions so Railway logs confirm which youtubei.js
  // resolved — pinning to v14.0.0 caused the "Failed to extract
  // signature decipher algorithm" error and broke all YouTube playback.
  try {
    const ytiVer = require('youtubei.js/package.json').version;
    const dpyVer = require('discord-player-youtubei/package.json').version;
    logger.warn(`musicService: youtubei.js@${ytiVer}, discord-player-youtubei@${dpyVer}`);
  } catch (e) {
    logger.warn('musicService: could not read package versions', { error: e?.message });
  }

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
  // useClient: 'IOS' avoids YouTube's signature-decipher entirely.
  // On cloud hosts (Railway, Heroku, etc.) YouTube blocks anonymous
  // streams — passing YOUTUBE_COOKIE (Netscape format) authenticates
  // the session and bypasses bot-detection.
  const youtubeCookie = process.env.YOUTUBE_COOKIE || null;
  if (youtubeCookie) {
    logger.info('musicService: YOUTUBE_COOKIE found — authenticated YouTube session will be used');
  } else {
    logger.warn('musicService: YOUTUBE_COOKIE not set — YouTube streams may be blocked on cloud hosts');
  }

  try {
    await player.extractors.register(YoutubeiExtractor, {
      authentication: youtubeCookie,
      streamOptions: {
        useClient: 'IOS',
      },
    });
    logger.info('musicService: YoutubeiExtractor registered (IOS client' + (youtubeCookie ? ', authenticated' : ', anonymous') + ')');
  } catch (err) {
    logger.warn('musicService: IOS client failed, retrying with ANDROID', { error: err?.message });
    try {
      await player.extractors.register(YoutubeiExtractor, {
        authentication: youtubeCookie,
        streamOptions: {
          useClient: 'ANDROID',
        },
      });
      logger.info('musicService: YoutubeiExtractor registered (ANDROID fallback' + (youtubeCookie ? ', authenticated' : ', anonymous') + ')');
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

  // Surface stream/player errors to the text channel so they're visible
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
