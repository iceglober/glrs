use crate::core::config;
use crate::plugin::registry::PluginRegistry;
use anyhow::{bail, Result};
use clap::Args;

#[derive(Args, Debug)]
pub struct ShellInitArgs {
    /// Shell type: bash, zsh, or fish
    pub shell: String,
}

/// Get the absolute path of the current binary for use in shell scripts.
fn binary_path() -> String {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.canonicalize().ok())
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "gs-assume".to_string())
}

pub async fn run(
    args: ShellInitArgs,
    registry: &PluginRegistry,
    cfg: &config::Config,
) -> Result<()> {
    let shell = &args.shell;
    let bin = binary_path();

    if !["bash", "zsh", "fish"].contains(&shell.as_str()) {
        bail!("Unsupported shell: {shell}. Supported: bash, zsh, fish");
    }

    println!("# gs-assume shell integration for {shell}");
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
        "bash" | "zsh" => print_posix_integration(&bin, shell),
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
        output=$(command {bin} "$@")
        local rc=$?
        if [[ $rc -eq 0 && "$output" == *"export "* ]]; then
            eval "$output"
        fi
        return $rc
    else
        command {bin} "$@"
    fi
}}
gs-assume() {{ gsa "$@"; }}"#
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
    println!(r#"# Prompt: reads $GS_ASSUME_CONTEXT (instant, no subprocess)"#);
    println!(r#"_gs_assume_prompt() {{"#);
    println!(r#"    if [[ -n "$GS_ASSUME_CONTEXT" ]]; then"#);
    println!(r#"        local color reset"#);
    println!(
        "        reset=\"{zw_open}\\033[0m{zw_close}\"",
        zw_open = zw_open,
        zw_close = zw_close
    );
    println!(r#"        case "$GS_ASSUME_CONTEXT_COLOR" in"#);
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
    println!(r#"        echo "${{color}}[$GS_ASSUME_CONTEXT]${{reset}} ""#);
    println!(r#"    fi"#);
    println!(r#"}}"#);
    println!(
        "if [[ \"${pv}\" != *'$(_gs_assume_prompt)'* ]]; then",
        pv = pv
    );
    println!("    {pv}='$(_gs_assume_prompt)'\"${pv}\"", pv = pv);
    println!(r#"fi"#);
}

fn print_fish_integration(bin: &str) {
    println!(
        r#"# Wrapper: `gsa use` and `gsa login` set per-shell context via env vars
function gsa
    if test "$argv[1]" = "use"; or test "$argv[1]" = "login"
        set -l tmpfile (mktemp)
        command {bin} $argv 2>/dev/stderr >$tmpfile
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
        command {bin} $argv
    end
end
function gs-assume; gsa $argv; end"#
    );
    println!();
    println!(
        r#"# Prompt: reads $GS_ASSUME_CONTEXT (instant, no subprocess)
if not functions -q _original_fish_prompt
    functions -c fish_prompt _original_fish_prompt
    function fish_prompt
        if test -n "$GS_ASSUME_CONTEXT"
            set -l color green
            if test "$GS_ASSUME_CONTEXT_COLOR" = "red"
                set color red
            end
            set_color $color
            echo -n "[$GS_ASSUME_CONTEXT] "
            set_color normal
        end
        _original_fish_prompt
    end
end"#
    );
}
