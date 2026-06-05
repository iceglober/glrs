---
"@glrs-dev/assume": minor
---

GCP now wraps the gcloud CLI instead of reimplementing Google OAuth.

Previously glrs ran its own Google OAuth (gcloud's client ID, auth-code flow, raw refresh-token grants) and emulated the GCE metadata server. Under an org that enforces reauth, raw refresh grants are rejected (`invalid_rapt`) and glrs had no reauth flow, so GCP wedged — and the emulated `GCE_METADATA_HOST` shadowed gcloud's own credentials.

glrs now delegates GCP auth to gcloud, the idiomatic local-dev path:

- `gsa login gcp` runs `gcloud auth login` + `gcloud auth application-default login` (interactive — satisfies org reauth and writes a proper ADC).
- Credentials are delivered by gcloud's **Application Default Credentials**, not the daemon. glrs no longer sets `GCE_METADATA_HOST`; apps read gcloud's ADC natively. The daemon binds no GCP endpoint.
- Contexts are projects via `gcloud projects list`; `gsa use gcp <project>` sets `GOOGLE_CLOUD_PROJECT` (and `--default` also `gcloud config set project`); `gsa exec`/agent mint a token via `gcloud ... print-access-token`.
- When gcloud needs interactive reauth, the next command surfaces "run: gsa login gcp" (via the needs-login marker) instead of leaking a raw token-endpoint error.
- **Requires the Google Cloud SDK (`gcloud`) on PATH** for GCP; the in-house OAuth/ADC writer/metadata emulation are removed. AWS is unaffected.
