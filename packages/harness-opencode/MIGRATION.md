# Migration Guide

## From the clone+symlink install to npm

The old `install.sh`-based harness (`~/.glorious/opencode/` clone) was replaced by the npm-delivered plugin. If you were using the clone+symlink model, see [docs/migration-from-clone-install.md](docs/migration-from-clone-install.md) for step-by-step instructions.

The short version:

```bash
# 1. Uninstall the old harness
curl -fsSL https://github.com/iceglober/harness-opencode/releases/download/v0-legacy-clone-install/uninstall.sh -o /tmp/legacy-uninstall.sh
bash /tmp/legacy-uninstall.sh

# 2. Remove dangling symlinks
find ~/.claude ~/.config/opencode -type l ! -exec test -e {} \; -print -delete

# 3. Install the npm plugin
bunx @glrs-dev/harness-plugin-opencode install

# 4. Start OpenCode
opencode
```
