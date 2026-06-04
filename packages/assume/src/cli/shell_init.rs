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
                eprintln!(
                    "✓ Wrote glrs-assume shell integration to {}",
                    display_home(&path)
                );
                eprintln!(
                    "  Restart your shell or run: source {}",
                    display_home(&path)
                );
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

    // Environment variables for each provider's credential endpoint. Only export
    // them for a provider glrs actually has a default for — otherwise vars like
    // GCE_METADATA_HOST would hijack GCP credential resolution for every app in
    // the shell even when glrs isn't managing GCP (e.g. logged out so you can use
    // gcloud's own auth, which — unlike glrs — handles org reauth).
    for provider_id in registry.ids() {
        if crate::core::cache::load_default(&provider_id).is_none() {
            continue;
        }
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

    // Seed GLRS_ASSUME_SEGMENTS from each provider's default so a brand-new shell
    // shows the ambient default in its prompt (and `gsa use` overrides it later).
    let seed = seed_segments();
    match shell.as_str() {
        "fish" => println!("set -gx GLRS_ASSUME_SEGMENTS \"{seed}\""),
        _ => println!("export GLRS_ASSUME_SEGMENTS=\"{seed}\""),
    }
    println!();

    // Shell wrapper + prompt — all shell-specific
    let two_line = cfg.prompt.layout != "inline";
    match shell.as_str() {
        "bash" | "zsh" => print_posix_integration(&bin, &shell, two_line),
        "fish" => print_fish_integration(&bin, two_line),
        _ => {}
    }

    Ok(())
}

/// Encode each provider's default context into a GLRS_ASSUME_SEGMENTS value
/// (`provider:label:color:override`, space-joined), all marked non-override.
fn seed_segments() -> String {
    crate::core::cache::load_all_defaults()
        .iter()
        .map(|ctx| {
            crate::shell::prompt::encode_segment(&crate::shell::prompt::Segment {
                provider: ctx.provider_id.clone(),
                label: ctx.display_name.clone(),
                color: super::use_cmd::context_color(ctx).to_string(),
                is_override: false,
            })
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn print_posix_integration(bin: &str, shell: &str, two_line: bool) {
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
    print!("{}", posix_prompt_block(shell, two_line));
}

/// The prompt half of the POSIX (bash/zsh) integration: a function that decodes
/// $GLRS_ASSUME_SEGMENTS into one `[provider:ctx]` bracket per provider (no
/// subprocess), and the guarded assignment that prepends it.
///
/// ANSI codes are emitted as real ESC bytes inside single-quoted assignments and
/// wrapped in zero-width markers (`%{ %}` zsh, `\[ \]` bash) so the shell doesn't
/// count them as visible width. An empty segment list renders a dim `[gsa]`, so
/// the tag is always present.
fn posix_prompt_block(shell: &str, two_line: bool) -> String {
    let is_zsh = shell == "zsh";
    let pv = if is_zsh { "PROMPT" } else { "PS1" };
    let (o, c) = if is_zsh { ("%{", "%}") } else { ("\\[", "\\]") };
    let esc = "\x1b"; // real ESC byte; single-quoted in shell so it's stored verbatim
    let split = if is_zsh {
        "${=GLRS_ASSUME_SEGMENTS}" // zsh needs ${=...} to word-split
    } else {
        "$GLRS_ASSUME_SEGMENTS"
    };
    let reset = format!("{o}{esc}[0m{c}");
    let dim = format!("{o}{esc}[90m{c}");

    let mut s = String::new();
    s.push_str("# Prompt: render one [provider:ctx] bracket per provider from\n");
    s.push_str("# $GLRS_ASSUME_SEGMENTS (instant, no subprocess).\n");
    s.push_str("_glrs_assume_prompt() {\n");
    s.push_str("    local out='' tok provider label color ovr col star\n");
    s.push_str(&format!("    local reset='{reset}'\n"));
    s.push_str(&format!("    for tok in {split}; do\n"));
    s.push_str("        provider=\"${tok%%:*}\"; tok=\"${tok#*:}\"\n");
    s.push_str("        label=\"${tok%%:*}\"; tok=\"${tok#*:}\"\n");
    s.push_str("        color=\"${tok%%:*}\"; ovr=\"${tok##*:}\"\n");
    s.push_str("        case \"$color\" in\n");
    s.push_str(&format!("            red)    col='{o}{esc}[31m{c}' ;;\n"));
    s.push_str(&format!("            yellow) col='{o}{esc}[33m{c}' ;;\n"));
    s.push_str(&format!("            blue)   col='{o}{esc}[34m{c}' ;;\n"));
    s.push_str(&format!("            *)      col='{o}{esc}[32m{c}' ;;\n"));
    s.push_str("        esac\n");
    s.push_str("        star=''; [ \"$ovr\" = \"1\" ] && star='*'\n");
    s.push_str("        out=\"${out}${col}[${provider}:${label}${star}]${reset}\"\n");
    s.push_str("    done\n");
    s.push_str(&format!(
        "    if [ -z \"$out\" ]; then out=\"{dim}[gsa]${{reset}}\"; fi\n"
    ));
    s.push_str("    printf '%s' \"$out\"\n");
    s.push_str("}\n");

    // `$()` strips trailing newlines, so a two-line layout puts the newline in
    // the assignment (outside the substitution), not in the function output.
    // Inline keeps a trailing space inside the substitution's single quotes.
    s.push_str(&format!(
        "if [[ \"${pv}\" != *'$(_glrs_assume_prompt)'* ]]; then\n"
    ));
    if is_zsh {
        // `$(...)` in PROMPT is only expanded with PROMPT_SUBST.
        s.push_str("    setopt PROMPT_SUBST\n");
    }
    if two_line {
        s.push_str(&format!(
            "    {pv}='$(_glrs_assume_prompt)'$'\\n'\"${pv}\"\n"
        ));
    } else {
        s.push_str(&format!("    {pv}='$(_glrs_assume_prompt) '\"${pv}\"\n"));
    }
    s.push_str("fi\n");
    s
}

fn print_fish_integration(bin: &str, two_line: bool) {
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
    // Fish handles ANSI width via set_color, so no zero-width markers are needed.
    // Renders one bracket per provider from $GLRS_ASSUME_SEGMENTS; empty → [gsa].
    let sep = if two_line {
        "echo ''"
    } else {
        r#"echo -n ' '"#
    };
    println!(
        r#"# Prompt: reads $GLRS_ASSUME_SEGMENTS (instant, no subprocess)
function _glrs_assume_prompt
    if set -q GLRS_ASSUME_SEGMENTS; and test -n "$GLRS_ASSUME_SEGMENTS"
        for tok in (string split ' ' -- $GLRS_ASSUME_SEGMENTS)
            set -l parts (string split ':' -- $tok)
            set -l provider $parts[1]
            set -l label $parts[2]
            set -l color $parts[3]
            set -l ovr $parts[4]
            set -l fcol green
            switch $color
                case red; set fcol red
                case yellow; set fcol yellow
                case blue; set fcol blue
            end
            set -l star ''
            test "$ovr" = '1'; and set star '*'
            set_color $fcol
            echo -n "[$provider:$label$star]"
            set_color normal
        end
    else
        set_color brblack
        echo -n '[gsa]'
        set_color normal
    end
end
if not functions -q _original_fish_prompt
    functions -c fish_prompt _original_fish_prompt
    function fish_prompt
        _glrs_assume_prompt
        {sep}
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
    SUPPORTED_SHELLS.contains(&name).then(|| name.to_string())
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
        assert_eq!(
            shell_from_path("/usr/local/bin/fish").as_deref(),
            Some("fish")
        );
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
