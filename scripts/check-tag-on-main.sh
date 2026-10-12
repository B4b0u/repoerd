#!/usr/bin/env bash
# Fails unless the commit of a release tag is on main. Usage: [TAG_NAME=<tag>] scripts/check-tag-on-main.sh <commit> [<main ref>]
set -euo pipefail

COMMIT="${1:?usage: scripts/check-tag-on-main.sh <commit> [<main ref>]}"
MAIN="${2:-origin/main}"
SEMVER='^v(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$'
# TAG_NAME (the ref name, set by the release workflow) must be strict semver: vX.Y.Z or vX.Y.Z-rc.1.
if [ -n "${TAG_NAME:-}" ] && ! [[ "$TAG_NAME" =~ $SEMVER ]]; then
  echo "::error::$TAG_NAME is not a strict semver tag (vX.Y.Z or vX.Y.Z-pre)" >&2
  exit 1
fi
if ! git merge-base --is-ancestor "$COMMIT" "$MAIN" 2> /dev/null; then
  echo "::error::$COMMIT is not on $MAIN: tag releases on main only" >&2
  exit 1
fi
echo "$COMMIT is on $MAIN"
