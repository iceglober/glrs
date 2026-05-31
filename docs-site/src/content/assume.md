# Assume

`@glrs-dev/assume` — Rust-based SSO credential manager for AWS and GCP. Standalone binary, installs separately from the [CLI](/cli).

```bash
npm i -g @glrs-dev/assume
```

## Usage

```bash
gsa login aws              # authenticate with AWS SSO
gsa login gcp              # authenticate with GCP
glrs-assume <role-arn>      # assume an AWS IAM role
```

`gsa` is a shorthand alias for `glrs-assume`.

## Platforms

Prebuilt binaries for:
- macOS arm64 (Apple Silicon)
- macOS x64
- Linux x64
- Linux arm64

## Why separate

Assume is a Rust binary distributed via npm's optional dependencies mechanism. It has no runtime dependency on Node.js or Bun — the npm package is just a delivery vehicle for the compiled binary.

It ships independently from the [CLI](/cli) and [harness](/harness) because credential management is a different concern from agent tooling. You can use one without the other.
