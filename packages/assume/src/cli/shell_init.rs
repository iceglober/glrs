use crate::core::config;
use crate::plugin::registry::PluginRegistry;
use crate::shell::prompt;
use anyhow::{bail, Result};
use clap::Args;

#[derive(Args, Debug)]
pub struct ShellInitArgs {
    /// Shell type: bash, zsh, or fish
    pub shell: String,
}

pub async fn run(
    args: ShellInitArgs,
    registry: &PluginRegistry,
    cfg: &config::Config,
) -> Result<()> {
    let shell = &args.shell;

    // Validate shell
    if !["bash", "zsh", "fish"].contains(&shell.as_str()) {
        bail!("Unsupported shell: {shell}. Supported: bash, zsh, fish");
    }

    println!("# gs-assume shell integration for {shell}");
    println!("# Add to your shell config: eval \"$(gs-assume shell-init {shell})\"");
    println!();

    // Environment variables for each provider
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
        println!("# {} environment", provider.display_name());
        for (key, value) in &env_vars {
            match shell.as_str() {
                "fish" => println!("set -gx {key} \"{value}\""),
                _ => println!("export {key}=\"{value}\""),
            }
        }
        println!();
    }

    // Auto-start daemon if not running
    println!("# Auto-start daemon");
    match shell.as_str() {
        "fish" => {
            println!("if not gs-assume status >/dev/null 2>&1");
            println!("    gs-assume serve &>/dev/null &");
            println!("    disown");
            println!("end");
        }
        _ => {
            println!("if ! gs-assume status >/dev/null 2>&1; then");
            println!("    gs-assume serve &>/dev/null &");
            println!("    disown");
            println!("fi");
        }
    }
    println!();

    // Prompt integration
    println!("# Prompt integration");
    print!("{}", prompt::prompt_function(shell));
    println!();

    Ok(())
}
