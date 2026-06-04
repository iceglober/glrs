---
"@glrs-dev/assume": patch
---

Only export a provider's ambient env when glrs has a default for it.

shell-init exported `GCE_METADATA_HOST` (and the AWS container vars) for every registered provider unconditionally — so even with GCP logged out, every shell routed all GCP credential resolution through glrs's daemon, shadowing gcloud's own ADC. Under an org that enforces reauth, glrs can't refresh GCP at all (it does raw refresh grants with no reauth flow), so this left GCP wedged with no fallback. Now each provider's ambient vars are emitted only when `gsa` actually has a default for it; `gsa logout gcp` (which clears the default) hands GCP credential resolution back to gcloud, which does handle reauth.
