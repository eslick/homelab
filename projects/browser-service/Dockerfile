# Image tag must match the playwright-core version in package.json (browsers are baked in).
FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY src ./src

# /data holds profile state, audit log and artifacts (named volume).
RUN mkdir -p /data && chown -R pwuser:pwuser /data /app
USER pwuser
ENV NODE_ENV=production PORT=8931 DATA_DIR=/data
EXPOSE 8931
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:8931/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
