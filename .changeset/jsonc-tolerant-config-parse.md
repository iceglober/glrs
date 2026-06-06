---
"@glrs-dev/harness-plugin-opencode": patch
---

The harness CLI now parses `opencode.json` tolerantly (JSONC), matching opencode itself.

`harness install`/`configure` and `doctor` previously used strict `JSON.parse`, so a config opencode loads fine — e.g. one with a trailing comma or a comment — would crash with "invalid JSON" and refuse to proceed. They now fall back to JSON5 when strict parsing fails, accepting the same conveniences opencode does. Genuinely malformed files still error and the merge still leaves them untouched.
