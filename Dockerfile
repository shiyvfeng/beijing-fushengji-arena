FROM node:24.19.0-bookworm-slim AS build
WORKDIR /app
COPY . .
RUN npm ci && npm run build

FROM node:24.19.0-bookworm-slim
ENV NODE_ENV=production ARENA_HOST=0.0.0.0 ARENA_PORT=3000 ARENA_DATA_DIR=/data
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/package.json
COPY --from=build --chown=node:node /app/dist /app/dist
COPY --from=build --chown=node:node /app/apps/server /app/apps/server
COPY --from=build --chown=node:node /app/apps/web/dist /app/apps/web/dist
COPY --from=build --chown=node:node /app/packages/contracts /app/packages/contracts
COPY --from=build --chown=node:node /app/showcase/scripts/build-arena-replay.mjs /app/showcase/scripts/build-arena-replay.mjs
COPY --from=build --chown=node:node /app/showcase/web/src /app/showcase/web/src
COPY --from=build --chown=node:node /app/showcase/samples /app/showcase/samples
RUN mkdir /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "apps/server/src/index.mjs"]
