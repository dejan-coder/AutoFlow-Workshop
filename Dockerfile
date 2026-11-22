# Bygger webben och kör API + webb i en och samma container
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production PORT=3000 WEB_DIR=/app/web/dist
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
# tsx behövs för att köra TypeScript-källkoden direkt
RUN npm ci --workspace server --include-workspace-root=false && npm install --workspace server --no-save tsx && npm cache clean --force
COPY server server
COPY --from=build /app/web/dist web/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "--import", "tsx", "server/src/index.ts"]
