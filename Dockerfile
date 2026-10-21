# Production images for the public demo (see docker-compose.prod.yml).
#   app: API, worker and the one-off schema migration (same image, different command)
#   web: the built UI served by nginx, which also proxies /api to the API

FROM node:22-bookworm-slim AS build
WORKDIR /app
# Manifests first, so dependency installs are cached until a package.json changes.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/embeddings/package.json packages/embeddings/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY apps/local-runner/package.json apps/local-runner/
RUN npm ci --no-audit --no-fund
COPY packages packages
COPY apps apps
RUN npm run build -w @awb/core -w @awb/embeddings -w @awb/api -w @awb/worker -w @awb/web

FROM build AS app
ENV NODE_ENV=production
# Local embedding and re-rank models download here on first use; a volume keeps them.
RUN mkdir -p node_modules/@huggingface/transformers/.cache \
 && chown -R node:node node_modules/@huggingface/transformers/.cache
USER node
CMD ["node", "apps/api/dist/index.js"]

FROM nginx:1.27-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
