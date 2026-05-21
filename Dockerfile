FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# System packages: ffmpeg is required by discord-player for audio
# transcoding (music). Installing the alpine package is more reliable
# than ffmpeg-static, whose bundled binary doesn't match alpine's musl.
RUN apk add --no-cache ffmpeg

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./

# Install only production dependencies.
# Using `npm install` (not `npm ci`) so npm can resolve newer transitive
# deps when we bump `discord-player-youtubei` to `latest` — YouTube
# breaks youtubei.js periodically and we need the latest patches.
RUN npm install --omit=dev --no-audit --no-fund

# Bundle app source
COPY . .

# Expose the health check port from src/app.js
EXPOSE 3000

# Start the bot
CMD [ "npm", "start" ]
