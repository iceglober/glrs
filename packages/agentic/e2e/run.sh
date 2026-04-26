#!/usr/bin/env bash
set -euo pipefail

# Build context must be monorepo root for workspace resolution
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

echo "Building e2e Docker image..."
docker build -f "$REPO_ROOT/packages/agentic/e2e/Dockerfile" -t gsag-e2e "$REPO_ROOT"

echo ""
echo "Running e2e tests..."
docker run --rm gsag-e2e
