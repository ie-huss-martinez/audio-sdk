#!/usr/bin/env bash
# Regenerates docs/capabilities.md by running the end-to-end suite in the
# pinned browser image of ci/Dockerfile, where CI runs (ADR 0025 in sdk-core),
# against this checkout's build. Run `pnpm build && pnpm build:examples` first.
set -euo pipefail
cd "$(dirname "$0")/.."
image="$(sed -n 's/^FROM //p' ci/Dockerfile)"
docker run --rm \
  --user "$(id -u):$(id -g)" \
  --env HOME=/tmp \
  --env UPDATE_CAPABILITIES=1 \
  --ipc=host \
  --volume "$PWD:/work" \
  --workdir /work/e2e \
  "$image" \
  node node_modules/@playwright/test/cli.js test
