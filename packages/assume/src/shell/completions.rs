use clap::Command;
use clap_complete::{generate, Shell};
use std::io;

/// Generate shell completions for the gs-assume CLI and write to stdout.
#[allow(dead_code)]
pub fn generate_completions(cmd: &mut Command, shell: Shell) {
    generate(shell, cmd, "gs-assume", &mut io::stdout());
}

/// Parse shell name string into clap_complete::Shell
#[allow(dead_code)]
pub fn parse_shell(name: &str) -> Option<Shell> {
    match name.to_lowercase().as_str() {
        "bash" => Some(Shell::Bash),
        "zsh" => Some(Shell::Zsh),
        "fish" => Some(Shell::Fish),
        "powershell" | "ps" => Some(Shell::PowerShell),
        "elvish" => Some(Shell::Elvish),
        _ => None,
    }
}
