#!/usr/bin/env bash
# Starts the image in demo mode and checks what a user gets. Usage: scripts/docker-smoke.sh <image>
# SMOKE_PLATFORM (e.g. linux/arm64) and SMOKE_WAIT_SECONDS (default 30) tune it for an emulated image.
set -euo pipefail

IMAGE="${1:?usage: scripts/docker-smoke.sh <image>}"
# SMOKE_PLATFORM=linux/arm64 runs an image of another architecture (QEMU); it starts slower.
PLATFORM_ARGS=()
if [ -n "${SMOKE_PLATFORM:-}" ]; then PLATFORM_ARGS=(--platform "$SMOKE_PLATFORM"); fi
WAIT_SECONDS="${SMOKE_WAIT_SECONDS:-30}"
CONTAINER="repoerd-smoke-$$"
# Response bodies go to a temporary file: `curl -o /dev/null` fails under Git Bash on Windows.
BODY="${TMPDIR:-/tmp}/repoerd-smoke-body-$$"
fail() { echo "FAIL: $*" >&2; docker logs "$CONTAINER" >&2 || true; exit 1; }
cleanup() { docker rm -f "$CONTAINER" > /dev/null 2>&1 || true; rm -f "$BODY"; }
trap cleanup EXIT
# A command failing outside a `|| fail` guard is reported with its line and the container logs.
set -E
on_error() {
  echo "FAIL: command failed at line $1" >&2
  docker logs "$CONTAINER" >&2 || true
}
trap 'on_error $LINENO' ERR

docker run -d ${PLATFORM_ARGS[@]+"${PLATFORM_ARGS[@]}"} --name "$CONTAINER" -p 127.0.0.1::3000 \
  -e GITHUB_MODE=fake -e SECRET_KEY=smoke-test-only-secret-key-0123456789 "$IMAGE" > /dev/null
PORT="$(docker port "$CONTAINER" 3000/tcp | head -n1 | sed 's/.*://')"
BASE="http://127.0.0.1:$PORT"
# Bodies go through a variable: a pipe closed early by `grep -q` would make curl fail under pipefail.
get() { local body; body="$(curl -fsS "$BASE$1")" && printf '%s' "$body"; }

for _ in $(seq 1 "$WAIT_SECONDS"); do
  curl -fsS "$BASE/healthz" > /dev/null 2>&1 && break
  sleep 1
done
get /healthz | grep -q '"status":"ok"' || fail "/healthz is not ok"

for route in / /acme/platform-monorepo; do
  headers="$(curl -fsS -D - -o "$BODY" "$BASE$route")"
  echo "$headers" | grep -qi '^content-type: text/html' || fail "$route is not HTML"
  echo "$headers" | grep -qi "^content-security-policy: .*default-src 'self'" || fail "$route has no CSP"
done

asset="$(get / | grep -o '/assets/[^"]*\.js' | sed -n 1p)"
[ -n "$asset" ] || fail "index.html references no script"
asset_headers="$(curl -fsS -D - -o "$BODY" "$BASE$asset")"
echo "$asset_headers" | grep -qi '^cache-control: public, max-age=31536000, immutable' \
  || fail "$asset is not cached for a year"

get /api/repos | grep -q '"repos"' || fail "/api/repos does not list repositories"
# The parsers (native SWC binary, parser child processes) work inside the image.
get /api/repos/acme/shop-prisma/schema | grep -q '"tables"' || fail "Prisma is not parsed"
get /api/repos/acme/blog-drizzle/schema | grep -q '"tables"' || fail "Drizzle is not parsed"
status="$(curl -s -o "$BODY" -w '%{http_code}' "$BASE/api/nope")"
[ "$status" = 404 ] || fail "/api/nope answered $status"
grep -q '"not_found"' "$BODY" || fail "/api/nope is not a JSON API error"

# The recovery command ships in the image and reads the same database (demo mode: the user dev).
admins="$(docker exec "$CONTAINER" repoerd-admin list-admins)" || fail "repoerd-admin list-admins failed"
echo "$admins" | grep -q '^dev ' || fail "repoerd-admin does not list the demo administrator: $admins"
usage_code=0
docker exec "$CONTAINER" repoerd-admin no-such-command > /dev/null 2>&1 || usage_code=$?
[ "$usage_code" = 2 ] || fail "repoerd-admin answered $usage_code to an unknown command"

user="$(docker exec "$CONTAINER" id -un)"
[ "$user" = node ] || fail "the server runs as $user"

start="$(date +%s)"
docker stop -t 10 "$CONTAINER" > /dev/null
elapsed=$(( $(date +%s) - start ))
code="$(docker inspect -f '{{.State.ExitCode}}' "$CONTAINER")"
[ "$elapsed" -lt 10 ] || fail "docker stop took ${elapsed}s"
[ "$code" = 0 ] || fail "the server exited with $code"

echo "Smoke test passed ($IMAGE)"
