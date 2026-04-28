---
"@glrs-dev/harness-plugin-opencode": patch
---

Fix `glrs-oc install` silently dropping reconfigured models and MCPs on re-run. When a user answers "Yes, reconfigure models" (or the new "Yes, reconfigure MCPs") prompt, the installer now writes the new selections into `opencode.json` via an imperative-edit path rather than letting the non-destructive merge policy preserve the existing values. Other plugin options and user-authored MCPs are preserved; a `.bak.<epoch>-<pid>` sibling is written before mutation.
