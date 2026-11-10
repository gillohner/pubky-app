FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV HUSKY=0 CYPRESS_INSTALL_BINARY=0 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY packages ./packages
COPY services/eventky-projection ./services/eventky-projection
RUN npm run eventky:projection:build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production EVENTKY_BIND=0.0.0.0 EVENTKY_PORT=8091 EVENTKY_DATABASE=/data/eventky.sqlite
RUN mkdir /data && chown node:node /data
COPY --from=build --chown=node:node /app/dist/eventky-projection/ ./
USER node
EXPOSE 8091
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:8091/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.cjs"]
