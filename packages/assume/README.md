# glorious-assume (gs-assume)

Terminal-native, multi-cloud credential manager. Authenticate once per provider, switch contexts instantly, never write credentials to disk in plaintext.

## Install

```bash
cargo install --path .
```

## Usage

```bash
gs-assume login aws          # Authenticate with AWS Identity Center
gs-assume use dev/deploy     # Switch to a context by fuzzy match
gs-assume status             # Show auth status across providers
gs-assume exec --profile aws:prod -- aws s3 ls  # Run with specific creds
gs-assume profiles           # List all available contexts
gs-assume serve              # Start credential daemon
```

## Configuration

Config lives at `~/.config/gs-assume/config.toml`. See the PRD for full config reference.
