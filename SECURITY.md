# Security policy

## Reporting a vulnerability

If you discover a security issue in any `@glrs-dev/*` package, please email:

**security@glrs.dev**

Do **not** file a public GitHub issue, open a public PR, or post in any public channel until we've had a chance to respond.

We'll acknowledge receipt within **2 business days** and work with you on a disclosure timeline. For critical issues affecting released versions, we publish an advisory via GitHub Security Advisories and npm's security-advisories feed at the same time we release the patched version.

## Supported versions

We support the **latest minor** of each package on the latest major. Patch fixes backport only if:

- The vulnerability is rated **High** or **Critical** (CVSS ≥ 7.0), AND
- The affected major is not yet end-of-life

## Scope

In scope:
- Any `@glrs-dev/*` npm package
- The `glrs-assume` crate on crates.io
- The `glrs.dev` docs site infrastructure (GCS bucket, CDN, load balancer)

Out of scope:
- Third-party dependencies (report upstream)
- Local agent prompts users have modified
- Issues in the archived `iceglober/harness-opencode` or `iceglober/glorious` repos (those are read-only; fixes land on `iceglober/glrs`)

## Safe harbor

We support coordinated disclosure. Good-faith security research that follows this policy is welcome — we won't pursue legal action for research conducted in accordance with these guidelines.
