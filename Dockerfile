FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.server.json vite.config.ts index.html ./
COPY src ./src
COPY server ./server
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 DATA_DIR=/app/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force \
    && mkdir /app/data && chown node:node /app/data
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health',{headers:process.env.HEALTH_TOKEN?{Authorization:'Bearer '+process.env.HEALTH_TOKEN}:{},signal:AbortSignal.timeout(8000)}).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status)}).catch(e=>{console.error('Healthcheck fehlgeschlagen:',e.message);process.exit(1)})"
CMD ["node", "dist-server/index.js"]
