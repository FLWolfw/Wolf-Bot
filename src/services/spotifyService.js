import axios from 'axios';
import crypto from 'crypto';
import { db } from '../utils/database.js';

const API = 'https://api.spotify.com/v1';
const AUTH = 'https://accounts.spotify.com';
const TOKEN_TTL_MS = 55 * 60 * 1000;

const key = (userId) => `spotify:user:${userId}`;
const stateKey = (state) => `spotify:oauth:state:${state}`;

function credentials() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Missing SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET or SPOTIFY_REDIRECT_URI');
  }
  return { clientId, clientSecret, redirectUri };
}

export function createSpotifyAuthUrl(userId) {
  const { clientId, redirectUri } = credentials();
  const state = crypto.randomBytes(32).toString('hex');
  const scopes = [
    'user-read-private',
    'user-read-email',
    'user-read-currently-playing',
    'user-read-playback-state',
    'user-modify-playback-state',
    'playlist-read-private',
    'playlist-read-collaborative',
  ].join(' ');

  db.set(stateKey(state), { userId, createdAt: Date.now() }, 10 * 60 * 1000);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: scopes,
    redirect_uri: redirectUri,
    state,
  });
  return `${AUTH}/authorize?${params.toString()}`;
}

export async function handleSpotifyCallback(code, state) {
  const pending = await db.get(stateKey(state));
  if (!pending?.userId || Date.now() - pending.createdAt > 10 * 60 * 1000) {
    throw new Error('Invalid or expired Spotify OAuth state');
  }
  await db.delete(stateKey(state));

  const { clientId, clientSecret, redirectUri } = credentials();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });

  const { data } = await axios.post(`${AUTH}/api/token`, body, {
    auth: { username: clientId, password: clientSecret },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000,
  });

  const profile = await spotifyRequest('/me', data.access_token);
  await db.set(key(pending.userId), {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + Math.min((data.expires_in || 3600) * 1000, TOKEN_TTL_MS),
    spotifyUserId: profile.id,
    displayName: profile.display_name,
    product: profile.product,
  });

  return { userId: pending.userId, profile };
}

async function refresh(userId, session) {
  const { clientId, clientSecret } = credentials();
  if (!session?.refreshToken) throw new Error('Spotify account is not connected');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: session.refreshToken,
  });
  const { data } = await axios.post(`${AUTH}/api/token`, body, {
    auth: { username: clientId, password: clientSecret },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000,
  });

  const updated = {
    ...session,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || session.refreshToken,
    expiresAt: Date.now() + Math.min((data.expires_in || 3600) * 1000, TOKEN_TTL_MS),
  };
  await db.set(key(userId), updated);
  return updated;
}

export async function getSession(userId) {
  return db.get(key(userId));
}

async function accessTokenFor(userId) {
  let session = await getSession(userId);
  if (!session) throw new Error('Spotify is not connected. Use /spotify connect first.');
  if (!session.accessToken || !session.refreshToken || Date.now() >= (session.expiresAt || 0)) {
    session = await refresh(userId, session);
  }
  return session.accessToken;
}

export async function spotifyRequest(path, accessToken, options = {}) {
  const { data } = await axios({
    url: `${API}${path}`,
    method: options.method || 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, ...(options.headers || {}) },
    data: options.data,
    params: options.params,
    timeout: 15000,
    validateStatus: (status) => status >= 200 && status < 300,
  });
  return data;
}

export async function spotifyApi(userId, path, options = {}) {
  let token = await accessTokenFor(userId);
  try {
    return await spotifyRequest(path, token, options);
  } catch (err) {
    if (err?.response?.status === 401) {
      const session = await getSession(userId);
      const refreshed = await refresh(userId, session);
      return spotifyRequest(path, refreshed.accessToken, options);
    }
    throw err;
  }
}

export async function getProfile(userId) { return spotifyApi(userId, '/me'); }
export async function getDevices(userId) { return spotifyApi(userId, '/me/player/devices'); }
export async function getPlayback(userId) { return spotifyApi(userId, '/me/player'); }
export async function getPlaylists(userId, limit = 50) {
  return spotifyApi(userId, '/me/playlists', { params: { limit: Math.min(Math.max(limit, 1), 50) } });
}
export async function getPlaylist(userId, playlistId, limit = 100) {
  return spotifyApi(userId, `/playlists/${encodeURIComponent(playlistId)}/items`, {
    params: { limit: Math.min(Math.max(limit, 1), 100) },
  });
}
export async function play(userId, deviceId, contextUri) {
  const params = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
  const data = contextUri ? { context_uri: contextUri } : undefined;
  return spotifyApi(userId, `/me/player/play${params}`, { method: 'PUT', data });
}
export async function pause(userId, deviceId) {
  const params = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
  return spotifyApi(userId, `/me/player/pause${params}`, { method: 'PUT' });
}
export async function resume(userId, deviceId) { return play(userId, deviceId); }
export async function next(userId, deviceId) {
  const params = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
  return spotifyApi(userId, `/me/player/next${params}`, { method: 'POST' });
}
export async function previous(userId, deviceId) {
  const params = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
  return spotifyApi(userId, `/me/player/previous${params}`, { method: 'POST' });
}
export async function setShuffle(userId, state, deviceId) {
  const params = new URLSearchParams({ state: String(Boolean(state)) });
  if (deviceId) params.set('device_id', deviceId);
  return spotifyApi(userId, `/me/player/shuffle?${params}`, { method: 'PUT' });
}
export async function setRepeat(userId, state, deviceId) {
  const params = new URLSearchParams({ state });
  if (deviceId) params.set('device_id', deviceId);
  return spotifyApi(userId, `/me/player/repeat?${params}`, { method: 'PUT' });
}
export async function disconnect(userId) { return db.delete(key(userId)); }
