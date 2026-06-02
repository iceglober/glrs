---
"@glrs-dev/assume": patch
---

docs(assume): lead the quick start with `gsa init`

The `gsa --help` quick start (and the README usage block) still told new users to
run `gsa login` / `gsa use` first — but those commands now refuse until `gsa init`
completes (init gate). Reordered both to start with `gsa init`, show that
`aws s3 ls` then works off the default context, and present `gsa use` as the
per-shell override. Also notes the pre-init allowlist. (docs-site/assume.md
"How it works" + "Contexts" updated to match.)
