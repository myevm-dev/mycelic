FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
FROM base AS build
COPY package*.json ./
COPY packages ./packages
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_NOSTR_RELAY_URL=
ARG NEXT_PUBLIC_STUN_URL=
ENV NEXT_PUBLIC_NOSTR_RELAY_URL=$NEXT_PUBLIC_NOSTR_RELAY_URL
ENV NEXT_PUBLIC_STUN_URL=$NEXT_PUBLIC_STUN_URL
RUN npm run build
FROM base AS runtime
ENV NODE_ENV=production
COPY package*.json ./
COPY packages ./packages
RUN npm ci --omit=dev && mkdir /data && chown node:node /data
COPY --from=build /app/.next ./.next
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/tsconfig.json /app/next.config.ts /app/.env.example ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","node_modules/next/dist/bin/next","start","--hostname","0.0.0.0","--port","3000"]
