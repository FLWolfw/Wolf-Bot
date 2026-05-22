FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# System packages: ffmpeg for audio transcoding, python3 + curl for yt-dlp.
# yt-dlp is required by discord-player-youtubei v2 for YouTube streaming —
# it handles YouTube's IP-based blocks better than the pure JS extractors.
RUN apk add --no-cache ffmpeg python3 curl \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Install app dependencies.
# Copy ONLY package.json — we deliberately don't copy package-lock.json so
# npm install resolves all deps fresh on every build. youtubei.js (a
# transitive of discord-player-youtubei) gets broken every few weeks by
# YouTube changes; pinning via lockfile traps us on a broken version.
COPY package.json ./

# Use `npm install` (not `npm ci`) so the override on youtubei.js below
# actually takes effect — no lockfile means npm does fresh resolution.
RUN npm install --omit=dev --no-audit --no-fund

# Bundle app source
COPY . .

# Expose the health check port from src/app.js
EXPOSE 3000

# Start the bot
CMD [ "npm", "start" ]
