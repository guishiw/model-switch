#!/usr/bin/env bash
# Plain-docker deployment (no docker-compose needed; works on Docker 18.09+).
# Usage: ./deploy/deploy.sh [--seed]
#   Expects .env in the project root with DATABASE_URL / REDIS_URL pointing at
#   ms-postgres / ms-redis (see deploy/env.server.example).
set -euo pipefail
cd "$(dirname "$0")/.."

NET=model-switch
HOST_PORT="${HOST_PORT:-9003}"
PG_PASSWORD="${PG_PASSWORD:-$(grep -E '^PG_PASSWORD=' .env | cut -d= -f2- || true)}"
[ -n "$PG_PASSWORD" ] || { echo "PG_PASSWORD missing in .env"; exit 1; }

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

log "network + volumes"
docker network inspect $NET >/dev/null 2>&1 || docker network create $NET
docker volume create ms-pgdata >/dev/null
docker volume create ms-redisdata >/dev/null

log "postgres"
if ! docker ps -a --format '{{.Names}}' | grep -qx ms-postgres; then
  docker run -d --name ms-postgres --network $NET --restart unless-stopped \
    -e POSTGRES_USER=relay -e POSTGRES_PASSWORD="$PG_PASSWORD" -e POSTGRES_DB=relay \
    -v ms-pgdata:/var/lib/postgresql/data postgres:16-alpine
fi
docker start ms-postgres >/dev/null

log "redis"
if ! docker ps -a --format '{{.Names}}' | grep -qx ms-redis; then
  docker run -d --name ms-redis --network $NET --restart unless-stopped \
    -v ms-redisdata:/data redis:7-alpine redis-server --appendonly yes --maxmemory-policy noeviction
fi
docker start ms-redis >/dev/null

log "build images"
docker build --target web    -t model-switch-web:latest .
docker build --target worker -t model-switch-worker:latest .

log "wait for postgres"
for i in $(seq 1 30); do
  docker exec ms-postgres pg_isready -U relay >/dev/null 2>&1 && break
  sleep 1
done

log "migrate"
docker run --rm --network $NET --env-file .env model-switch-worker:latest npx prisma migrate deploy

if [ "${1:-}" = "--seed" ]; then
  log "seed"
  docker run --rm --network $NET --env-file .env -e SEED_OLLAMA=false model-switch-worker:latest npx tsx prisma/seed.ts
fi

log "restart app containers"
for c in ms-web ms-worker; do docker rm -f $c >/dev/null 2>&1 || true; done
docker run -d --name ms-web --network $NET --restart unless-stopped \
  --env-file .env -e NODE_ENV=production -e HOSTNAME=0.0.0.0 -e PORT=3000 \
  -p "${HOST_PORT}:3000" model-switch-web:latest
docker run -d --name ms-worker --network $NET --restart unless-stopped \
  --env-file .env -e NODE_ENV=production model-switch-worker:latest

log "cleanup dangling images"
docker image prune -f >/dev/null

log "done"
docker ps --filter name=ms- --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
