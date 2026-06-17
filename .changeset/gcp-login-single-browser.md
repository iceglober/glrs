---
"@glrs-dev/assume": patch
---

fix(gcp): open only one browser on `gsa login gcp`

`gcloud::login()` ran two interactive OAuth flows back to back — `gcloud auth login` (CLI credentials) followed by `gcloud auth application-default login` (ADC) — so re-authenticating opened the browser twice, with an extra "Do you want to continue?" prompt in between when `GOOGLE_APPLICATION_CREDENTIALS` points at the ADC file. Collapse to a single `gcloud auth login --update-adc`, which writes ADC from the same flow, then restore the ADC quota project non-interactively (best-effort) since `--update-adc` does not stamp it.
