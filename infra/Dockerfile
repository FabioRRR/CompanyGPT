# Ein Image für API und Worker – der Startbefehl entscheidet die Rolle.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
RUN npm ci --omit=dev && npm install --no-save tsx@4

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages ./packages
COPY apps ./apps
COPY db ./db
USER node
EXPOSE 8080
# Standard: API. Worker: `node --import tsx apps/worker/src/index.ts`
CMD ["node", "--import", "tsx", "apps/api/src/index.ts"]
