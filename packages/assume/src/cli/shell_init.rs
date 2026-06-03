use crate::core::config;
use crate::core::daemon::DaemonRequirement;
use crate::plugin::registry::PluginRegistry;
use anyhow::{anyhow, bail, Result};
use clap::Args;
use std::path::{Path, PathBuf};

pub const REQUIREMENT: DaemonRequirement = DaemonRequirement::BackgroundEnsure;

#[derive(Args, Debug)]
pub struct ShellInitArgs {
    /// Shell type: bash, zsh, or fish. Auto-detected from $SHELL if omitted.
    pub shell: Option<String>,

    /// Append the integration to your shell rc file instead of printing it.
    /// Idempotent — re-running leaves an already-installed rc untouched.
    #[arg(long)]
    pub install: bool,
}

const SUPPORTED_SHELLS: [&str; 3] = ["bash", "zsh", "fish"];

/// Marker opening the managed block in a user's rc file. Its presence is the
/// idempotency check: if the rc already contains it, `--install` is a no-op.
const RC_MARKER_OPEN: &str = "# >>> glrs-assume >>>";
const RC_MARKER_CLOSE: &str = "# <<< glrs-assume <<<";

pub enum InstallOutcome {
    Added(PathBuf),
    AlreadyPresent(PathBuf),
}

/// Get the absolute path of the current binary for use in shell scripts.
fn binary_path() -> String {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.canonicalize().ok())
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "glrs-assume".to_string())
}

pub async fn run(
    args: ShellInitArgs,
    registry: &PluginRegistry,
    cfg: &config::Config,
) -> Result<()> {
    let shell = resolve_shell(args.shell.as_deref())?;

    // `--install`: wire the integration into the rc file (idempotent) instead
    // of printing the script for the user to eval themselves.
    if args.install {
        match install_shell_integration(&shell)? {
            InstallOutcome::Added(path) => {
                eprintln!("✓ Wrote glrs-assume shell integration to {}", display_home(&path));
                eprintln!("  Restart your shell or run: source {}", display_home(&path));
            }
            InstallOutcome::AlreadyPresent(path) => {
                eprintln!(
                    "✓ glrs-assume shell integration already present in {}",
                    display_home(&path)
                );
            }
        }
        return Ok(());
    }

    let bin = binary_path();
    println!("# glrs-assume shell integration for {shell}");
    println!();

    // Environment variables for each provider's credential endpoint
    for provider_id in registry.ids() {
        let provider = registry.get(&provider_id).unwrap();
        let port = cfg
            .providers
            .get(&provider_id)
            .and_then(|p| p.port)
            .unwrap_or_else(|| {
                let endpoint = provider.credential_endpoint();
                endpoint.port
            });

        let env_vars = provider.shell_env(port);
        for (key, value) in &env_vars {
            match shell.as_str() {
                "fish" => println!("set -gx {key} \"{value}\""),
                _ => println!("export {key}=\"{value}\""),
            }
        }
    }
    println!();

    // Shell wrapper + prompt — all shell-specific
    match shell.as_str() {
        "bash" | "zsh" => print_posix_integration(&bin, &shell),
        "fish" => print_fish_integration(&bin),
        _ => {}
    }

    Ok(())
}

fn print_posix_integration(bin: &str, shell: &str) {
    // Wrapper function: intercepts `gsa use` and `gsa login` to eval env var exports
    // stdout has export lines, stderr has human messages — $() only captures stdout
    println!(
        r#"# Wrapper: `gsa use` and `gsa login` set per-shell context via env vars
gsa() {{
    if [[ "$1" == "use" || "$1" == "login" ]]; then
        local output
        output=$(GLRS_CLI_DISPATCHED=1 command {bin} "$@")
        local rc=$?
        if [[ $rc -eq 0 && "$output" == *"export "* ]]; then
            eval "$output"
        fi
        return $rc
    else
        GLRS_CLI_DISPATCHED=1 command {bin} "$@"
    fi
}}
glrs-assume() {{ gsa "$@"; }}"#
    );
    println!();

    // Prompt: reads env var directly — zero process spawning
    // ANSI codes must be wrapped in zero-width markers so the shell doesn't
    // count them as visible characters (which breaks cursor positioning).
    //   zsh:  %{...\e[32m...%}
    //   bash: \[...\e[32m...\]
    let pv = if shell == "zsh" { "PROMPT" } else { "PS1" };
    let (zw_open, zw_close) = if shell == "zsh" {
        ("%{", "%}")
    } else {
        ("\\[", "\\]")
    };
    println!(r#"# Prompt: reads $GLRS_ASSUME_CONTEXT (instant, no subprocess)"#);
    println!(r#"_glrs_assume_prompt() {{"#);
    println!(r#"    if [[ -n "$GLRS_ASSUME_CONTEXT" ]]; then"#);
    println!(r#"        local color reset"#);
    println!(
        "        reset=\"{zw_open}\\033[0m{zw_close}\"",
        zw_open = zw_open,
        zw_close = zw_close
    );
    println!(r#"        case "$GLRS_ASSUME_CONTEXT_COLOR" in"#);
    println!(
        "            red)    color=\"{zw_open}\\033[31m{zw_close}\" ;;",
        zw_open = zw_open,
        zw_close = zw_close
    );
    println!(
        "            yellow) color=\"{zw_open}\\033[33m{zw_close}\" ;;",
        zw_open = zw_open,
        zw_close = zw_close
    );
    println!(
        "            *)      color=\"{zw_open}\\033[32m{zw_close}\" ;;",
        zw_open = zw_open,
        zw_close = zw_close
    );
    println!(r#"        esac"#);
    println!(r#"        echo "${{color}}[$GLRS_ASSUME_CONTEXT]${{reset}} ""#);
    println!(r#"    fi"#);
    println!(r#"}}"#);
    println!(
        "if [[ \"${pv}\" != *'$(_glrs_assume_prompt)'* ]]; then",
        pv = pv
    );
    println!("    {pv}='$(_glrs_assume_prompt)'\"${pv}\"", pv = pv);
    println!(r#"fi"#);
}

fn print_fish_integration(bin: &str) {
    println!(
        r#"# Wrapper: `gsa use` and `gsa login` set per-shell context via env vars
function gsa
    if test "$argv[1]" = "use"; or test "$argv[1]" = "login"
        set -l tmpfile (mktemp)
        GLRS_CLI_DISPATCHED=1 command {bin} $argv 2>/dev/stderr >$tmpfile
        set -l rc $status
        if test $rc -eq 0
            for line in (cat $tmpfile)
                if string match -q 'export *' $line
                    set -l kv (string replace 'export ' '' $line)
                    set -l parts (string split '=' $kv)
                    set -gx $parts[1] (string trim -c '"' $parts[2])
                end
            end
        end
        rm -f $tmpfile
        return $rc
    else
        GLRS_CLI_DISPATCHED=1 command {bin} $argv
    end
end
function glrs-assume; gsa $argv; end"#
    );
    println!();
    println!(
        r#"# Prompt: reads $GLRS_ASSUME_CONTEXT (instant, no subprocess)
if not functions -q _original_fish_prompt
    functions -c fish_prompt _original_fish_prompt
    function fish_prompt
        if test -n "$GLRS_ASSUME_CONTEXT"
            set -l color green
            if test "$GLRS_ASSUME_CONTEXT_COLOR" = "red"
                set color red
            end
            set_color $color
            echo -n "[$GLRS_ASSUME_CONTEXT] "
            set_color normal
        end
        _original_fish_prompt
    end
end"#
    );
}

// ---- rc-file install (`--install` / `gsa init`) ----

/// Resolve the target shell: an explicit argument, else `$SHELL`. Errors with
/// guidance when neither yields a supported shell.
fn resolve_shell(arg: Option<&str>) -> Result<String> {
    let shell = match arg {
        Some(s) => s.to_string(),
        None => detect_shell().ok_or_else(|| {
            anyhow!(
                "Could not detect your shell from $SHELL. \
                 Pass one explicitly, e.g. `gsa shell-init zsh`."
            )
        })?,
    };
    if !SUPPORTED_SHELLS.contains(&shell.as_str()) {
        bail!("Unsupported shell: {shell}. Supported: bash, zsh, fish");
    }
    Ok(shell)
}

/// Best-effort current shell from `$SHELL` (e.g. `/bin/zsh` → `zsh`), or None
/// when it isn't one we support.
pub fn detect_shell() -> Option<String> {
    shell_from_path(&std::env::var("SHELL").ok()?)
}

/// Map a shell binary path to a supported shell name. Pure — unit-testable
/// without touching the environment. Handles login-shell `-zsh` forms.
fn shell_from_path(shell_path: &str) -> Option<String> {
    let name = Path::new(shell_path).file_name()?.to_string_lossy();
    let name = name.trim_start_matches('-');
    SUPPORTED_SHELLS
        .contains(&name)
        .then(|| name.to_string())
}

/// rc file a shell sources on startup. zsh → `~/.zshrc`, bash → `~/.bashrc`,
/// fish → `$XDG_CONFIG_HOME/fish/config.fish` (default `~/.config`).
fn rc_path_for(shell: &str) -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("cannot determine home directory"))?;
    Ok(match shell {
        "zsh" => home.join(".zshrc"),
        "bash" => home.join(".bashrc"),
        "fish" => {
            let base = std::env::var_os("XDG_CONFIG_HOME")
                .map(PathBuf::from)
                .filter(|p| !p.as_os_str().is_empty())
                .unwrap_or_else(|| home.join(".config"));
            base.join("fish").join("config.fish")
        }
        other => bail!("Unsupported shell: {other}. Supported: bash, zsh, fish"),
    })
}

/// The guarded block appended to the rc file. References `gsa` by name (not an
/// absolute path) so it survives upgrades that relocate the binary: the `gsa`
/// shim on PATH is the stable entry point; canonicalized package paths are not.
fn integration_block(shell: &str) -> String {
    let line = if shell == "fish" {
        "gsa shell-init fish | source".to_string()
    } else {
        format!(r#"eval "$(gsa shell-init {shell})""#)
    };
    format!(
        "\n{RC_MARKER_OPEN}\n\
         # Managed by `gsa init` — remove this block to disable glrs-assume shell integration.\n\
         {line}\n\
         {RC_MARKER_CLOSE}\n"
    )
}

/// Append the integration block to `shell`'s rc file, creating it (and parent
/// dirs) if absent. Idempotent: an rc already carrying the marker is left
/// untouched.
pub fn install_shell_integration(shell: &str) -> Result<InstallOutcome> {
    let path = rc_path_for(shell)?;
    append_block_idempotent(&path, &integration_block(shell))
}

/// Core of `install_shell_integration`, split out so the file path is
/// injectable for tests. Returns `AlreadyPresent` without writing when the
/// marker is already in the file.
fn append_block_idempotent(path: &Path, block: &str) -> Result<InstallOutcome> {
    let existing = std::fs::read_to_string(path).unwrap_or_default();
    if existing.contains(RC_MARKER_OPEN) {
        return Ok(InstallOutcome::AlreadyPresent(path.to_path_buf()));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    // The block opens with its own newline; add one more only if the existing
    // content doesn't already end a line, so we never glue onto a half-line.
    let mut out = existing;
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str(block);
    std::fs::write(path, out)?;
    Ok(InstallOutcome::Added(path.to_path_buf()))
}

/// Whether `shell`'s rc file already carries our integration block. Used to
/// decide whether to nudge the user (e.g. from `gsa status`). False when the
/// rc is absent or unreadable.
pub fn integration_block_present(shell: &str) -> bool {
    rc_path_for(shell)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|c| c.contains(RC_MARKER_OPEN))
        .unwrap_or(false)
}

/// Render a path with the home dir collapsed to `~` for friendlier output.
fn display_home(path: &Path) -> String {
    if let Some(home) = dirs::home_dir() {
        if let Ok(rest) = path.strip_prefix(&home) {
            return format!("~/{}", rest.display());
        }
    }
    path.display().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_from_path_recognizes_supported_shells() {
        assert_eq!(shell_from_path("/bin/zsh").as_deref(), Some("zsh"));
        assert_eq!(shell_from_path("/usr/bin/bash").as_deref(), Some("bash"));
        assert_eq!(shell_from_path("/usr/local/bin/fish").as_deref(), Some("fish"));
        assert_eq!(shell_from_path("-zsh").as_deref(), Some("zsh")); // login shell form
        assert_eq!(shell_from_path("/bin/dash"), None);
        assert_eq!(shell_from_path(""), None);
    }

    #[test]
    fn posix_block_has_markers_and_eval_line() {
        let block = integration_block("zsh");
        assert!(block.contains(RC_MARKER_OPEN));
        assert!(block.contains(RC_MARKER_CLOSE));
        assert!(block.contains(r#"eval "$(gsa shell-init zsh)""#));
    }

    #[test]
    fn fish_block_uses_source_pipe() {
        let block = integration_block("fish");
        assert!(block.contains("gsa shell-init fish | source"));
        assert!(!block.contains("eval"));
    }

    #[test]
    fn append_creates_then_is_idempotent() {
        let dir = std::env::temp_dir().join(format!("gsa-shellinit-{}", std::process::id()));
        let path = dir.join("nested/.zshrc");
        let _ = std::fs::remove_dir_all(&dir);

        let block = integration_block("zsh");

        // First install creates the file + parent dirs and writes the block.
        match append_block_idempotent(&path, &block).unwrap() {
            InstallOutcome::Added(p) => assert_eq!(p, path),
            InstallOutcome::AlreadyPresent(_) => panic!("expected Added"),
        }
        let after_first = std::fs::read_to_string(&path).unwrap();
        assert!(after_first.contains(RC_MARKER_OPEN));

        // Second install is a no-op: same content, marker present exactly once.
        match append_block_idempotent(&path, &block).unwrap() {
            InstallOutcome::AlreadyPresent(_) => {}
            InstallOutcome::Added(_) => panic!("expected AlreadyPresent"),
        }
        let after_second = std::fs::read_to_string(&path).unwrap();
        assert_eq!(after_first, after_second);
        assert_eq!(after_second.matches(RC_MARKER_OPEN).count(), 1);

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn append_preserves_existing_content_and_separates() {
        let dir = std::env::temp_dir().join(format!("gsa-shellinit2-{}", std::process::id()));
        let path = dir.join(".zshrc");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // No trailing newline — exercises the separator insertion.
        std::fs::write(&path, "export EDITOR=vim").unwrap();

        append_block_idempotent(&path, &integration_block("zsh")).unwrap();

        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.starts_with("export EDITOR=vim\n"));
        assert!(content.contains(RC_MARKER_OPEN));
        // The user's line and the marker must not share a line.
        assert!(!content.contains("export EDITOR=vim# >>>"));

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
