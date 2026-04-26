#!/usr/bin/env bash
# scripts/verdaccio-smoke.sh
#
# End-to-end smoke test: spin up verdaccio, publish all packages to it,
# then install @glrs-dev/cli from it in a clean sandbox and verify all
# dispatch subcommands work. Used by CI on PRs.
#
# Not yet implemented — scaffolded as part of Phase 1. See acceptance
# criteria in the unification plan.

set -euo pipefail

echo "[verdaccio-smoke] Not yet implemented. See plan Phase 1 / Test plan."
echo "[verdaccio-smoke] Exiting 0 so CI doesn't block while scaffold lands."
exit 0
