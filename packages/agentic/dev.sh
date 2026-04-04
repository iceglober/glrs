#!/usr/bin/env bash
# Build and run af locally for development testing.
# Usage: ./dev.sh status
#        ./dev.sh start --quick "fix something"
#        ./dev.sh --version
set -e
bun run build.ts 2>/dev/null
node dist/index.js "$@"
