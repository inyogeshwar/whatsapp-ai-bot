# WhatsApp AI Bot — container image
#
#   docker build -t whatsapp-ai-bot .
#   docker run -d --init --name wa-bot \
#     -v "$PWD/auth:/app/auth" -v "$PWD/data:/app/data" \
#     --env-file .env --restart unless-stopped whatsapp-ai-bot
#
# The auth/ and data/ volumes matter: with LOGIN_METHOD=pairing you only link
# once, and group settings should survive a container rebuild.

FROM node:22-bookworm-slim

ENV NODE_ENV=production

WORKDIR /app

# Install dependencies first so rebuilds reuse the layer when only source changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# No ports are exposed — the bot only makes outbound connections.

CMD ["node", "src/index.js"]
