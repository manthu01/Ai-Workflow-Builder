# Public demo as a single container, for a Hugging Face Docker Space.
# A Space runs one container as uid 1000 and routes traffic to port 7860, so
# Postgres (pgvector), the Temporal dev server, the API, the worker and nginx
# all run here, started by start.sh. Everything lives in /tmp: a restart is a
# fresh demo, which matches demo mode's own 24h retention.
#
# The Space repo holds only this file and a README; the source is cloned from
# GitHub at REF. Bump REF to deploy a new commit (it also busts the build cache).

FROM temporalio/temporal:1.8.3 AS temporal

FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git nginx openssl \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-16 postgresql-16-pgvector \
 && rm -rf /var/lib/apt/lists/*

COPY --from=temporal /usr/local/bin/temporal /usr/local/bin/temporal

# The node image's `node` user is uid 1000, the uid Spaces run as.
RUN mkdir /app && chown node:node /app
USER node
WORKDIR /app

ARG REPO=https://github.com/manthu01/Ai-Workflow-Builder.git
ARG REF=main
RUN git init -q . && git remote add origin "$REPO" \
 && git fetch -q --depth 1 origin "$REF" && git checkout -q FETCH_HEAD

RUN npm ci --no-audit --no-fund \
 && npm run build -w @awb/core -w @awb/embeddings -w @awb/api -w @awb/worker -w @awb/web

# Bake the local embedding and re-rank models into the image, so the first
# knowledge-base search after a cold start doesn't wait on a download.
RUN node --input-type=module -e "\
import { pipeline, AutoTokenizer, AutoModelForSequenceClassification } from '@huggingface/transformers'; \
await pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5', { dtype: 'fp32' }); \
await AutoTokenizer.from_pretrained('Xenova/ms-marco-MiniLM-L-6-v2'); \
await AutoModelForSequenceClassification.from_pretrained('Xenova/ms-marco-MiniLM-L-6-v2', { dtype: 'fp32' });"

ENV NODE_ENV=production \
    DEMO_MODE=true \
    DEMO_COOKIE_CROSS_SITE=true \
    PUBLIC_URL=https://manthu01-ai-workflow-builder.hf.space \
    WEB_ORIGIN=https://manthu01-ai-workflow-builder.hf.space \
    COMPILER_MODE=stub \
    DRY_RUN_LLM=mock \
    EMBEDDINGS_MODE=local \
    EMBEDDING_DIMENSIONS=384 \
    RERANK_MODE=local \
    API_PORT=8787 \
    DATABASE_URL=postgres://awb@127.0.0.1:5432/awb \
    TEMPORAL_ADDRESS=127.0.0.1:7233 \
    AWB_API_URL=http://127.0.0.1:8787

EXPOSE 7860
CMD ["bash", "deploy/hf/start.sh"]
