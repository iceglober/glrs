---
"@glrs-dev/assume": patch
---

fix(assume): stop daemons wedging on blocking gcloud calls; fix `gsa upgrade` on bun

Two robustness fixes uncovered while cleaning up an orphaned-daemon pile:

- **Daemons could become unkillable.** The GCP keep-warm and credential paths called `gcloud` synchronously inside async fns, so a slow or stuck gcloud blocked a tokio worker thread. With enough blocked workers the runtime couldn't even process its own SIGTERM — leaving daemons immortal (a plain `pkill` did nothing) and piling up. The blocking gcloud calls now run on the blocking pool via `spawn_blocking`, and `stop_daemon` escalates SIGTERM→SIGKILL after a 2s grace period so restart and shutdown always land.
- **`gsa upgrade` failed on bun-only machines.** Install detection treated any `node_modules` path as an npm install, but bun's global install (`~/.bun/install/global/node_modules/...`) also contains `node_modules` — so `gsa upgrade` ran `npm`, which isn't on a bun-only PATH (`could not run npm`). Detection now distinguishes bun / pnpm / npm and upgrades with the matching package manager.
