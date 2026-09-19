FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=3005

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node server.js mcp-server.js ./

USER node

EXPOSE 3005

CMD ["node", "server.js"]
