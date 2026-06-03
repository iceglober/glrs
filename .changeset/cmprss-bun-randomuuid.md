---
"@glrs-dev/cmprss": patch
---

fix(cmprss): use node:crypto randomUUID so token/id generation works on Bun

`cmprss wrap <agent>` crashed immediately on Bun with
`TypeError: Expected this to be instanceof Crypto`. Two helpers
(`randomToken` for the stub bearer, `cryptoRandomId` for message ids)
detached `globalThis.crypto.randomUUID` from its receiver and called it bare.
The WebCrypto `randomUUID` is a method that checks `this` is a `Crypto`
instance — Bun enforces this; Node tolerates it, so the form passed Node
testing but crashed on a Bun-only machine.

Switched both to `node:crypto`'s standalone `randomUUID`, consolidated the
duplicated helper into `src/lib/id.ts`, and added a Bun regression test (it
runs under Bun, so reintroducing the detached-method form fails the test).
