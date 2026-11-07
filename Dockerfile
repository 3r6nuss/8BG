FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3001 DATA_DIR=/app/data
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force \
    && mkdir -p /app/data \
    && chown -R node:node /app
COPY --chown=node:node . .
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health',{headers:{Authorization:'Bearer '+process.env.HEALTH_TOKEN},signal:AbortSignal.timeout(8000)}).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status)}).catch(e=>{console.error('Healthcheck fehlgeschlagen:',e.message);process.exit(1)})"
CMD ["node","server.js"]
