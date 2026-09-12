# NestJS API — Cloud Run
# Cloud Run injects PORT=8080 and requires the process to bind 0.0.0.0.

FROM node:20-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY prisma ./prisma/
COPY nest-cli.json tsconfig.json tsconfig.build.json ./

RUN npm install --ignore-scripts

COPY src ./src
COPY scripts ./scripts

RUN npx prisma generate
RUN npm run build

FROM node:20-bookworm-slim AS production

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY prisma ./prisma/

RUN npm install --omit=dev --ignore-scripts \
  && npm install prisma --omit=dev --ignore-scripts \
  && npx prisma generate \
  && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY scripts/cloud-run-start.sh ./scripts/cloud-run-start.sh

RUN chmod +x ./scripts/cloud-run-start.sh \
  && chown -R node:node /app

USER node

EXPOSE 8080

CMD ["./scripts/cloud-run-start.sh"]
