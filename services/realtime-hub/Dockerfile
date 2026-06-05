# Realtime fan-out hub — runs as its own long-lived service (see ADR 0001).
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Install production dependencies (tsx, ws, zod) using the lockfile.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:8080/healthz || exit 1

CMD ["npm", "start"]
