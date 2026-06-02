use crate::core::daemon::DaemonRequirement;
use clap::Args;
use std::fs;
use std::os::unix::fs::PermissionsExt;

pub const REQUIREMENT: DaemonRequirement = DaemonRequirement::None;

// Post-monorepo coordinates. The pre-rename repo (`iceglober/glorious`, tag
// prefix `assume-v`) froze at ~0.6.x, so pointing here made `gsa upgrade`
// report that stale release as "latest" and refuse to update. Releases now live
// in `iceglober/glrs` under changesets tags like `@glrs-dev/assume@0.10.1`.
const REPO: &str = "iceglober/glrs";
const TAG_PREFIX: &str = "@glrs-dev/assume@";

#[derive(Args)]
pub struct UpgradeArgs {}

struct Release {
    version: String,
    tag: String,
    asset_url: String,
}

fn detect_platform() -> &'static str {
    let os = if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    };
    let arch = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "amd64"
    };
    // Return static str via leak since there are only 4 possibilities
    match (os, arch) {
        ("darwin", "arm64") => "darwin-arm64",
        ("darwin", "amd64") => "darwin-amd64",
        ("linux", "arm64") => "linux-arm64",
        ("linux", "amd64") => "linux-amd64",
        _ => "linux-amd64",
    }
}

fn compare_versions(a: &str, b: &str) -> std::cmp::Ordering {
    let parse = |v: &str| -> Vec<u64> { v.split('.').map(|s| s.parse().unwrap_or(0)).collect() };
    let pa = parse(a);
    let pb = parse(b);
    let len = pa.len().max(pb.len());
    for i in 0..len {
        let na = pa.get(i).copied().unwrap_or(0);
        let nb = pb.get(i).copied().unwrap_or(0);
        match na.cmp(&nb) {
            std::cmp::Ordering::Equal => continue,
            other => return other,
        }
    }
    std::cmp::Ordering::Equal
}

/// Try gh CLI first, then fall back to GitHub REST API
async fn fetch_latest_release() -> anyhow::Result<Option<Release>> {
    // Try gh CLI
    if let Some(release) = try_gh_cli() {
        return Ok(Some(release));
    }

    // Fall back to REST API
    fetch_from_api().await
}

fn try_gh_cli() -> Option<Release> {
    let output = std::process::Command::new("gh")
        .args([
            "release", "list", "-R", REPO, "--json", "tagName", "-L", "50",
        ])
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8(output.stdout).ok()?;
    let releases: Vec<serde_json::Value> = serde_json::from_str(&stdout).ok()?;

    // Pick the highest-semver matching tag, not the first in list order. The
    // list mixes assume/cli/harness releases and isn't guaranteed to be sorted
    // the way we need; compare_versions is the source of truth.
    let tag = releases
        .iter()
        .filter_map(|r| r.get("tagName").and_then(|t| t.as_str()))
        .filter(|t| t.starts_with(TAG_PREFIX))
        .max_by(|a, b| {
            compare_versions(
                a.strip_prefix(TAG_PREFIX).unwrap_or(a),
                b.strip_prefix(TAG_PREFIX).unwrap_or(b),
            )
        })?
        .to_string();
    let version = tag.strip_prefix(TAG_PREFIX)?.to_string();

    Some(Release {
        version,
        tag,
        asset_url: String::new(), // gh CLI downloads by tag
    })
}

async fn fetch_from_api() -> anyhow::Result<Option<Release>> {
    let token = std::env::var("GITHUB_TOKEN")
        .or_else(|_| std::env::var("GH_TOKEN"))
        .ok();

    let client = reqwest::Client::new();
    let mut req = client
        .get(format!(
            "https://api.github.com/repos/{REPO}/releases?per_page=20"
        ))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "glrs-assume-cli")
        .header("X-GitHub-Api-Version", "2022-11-28");

    if let Some(ref tok) = token {
        req = req.header("Authorization", format!("Bearer {tok}"));
    }

    let resp = req.send().await?;
    if !resp.status().is_success() {
        return Ok(None);
    }

    let releases: Vec<serde_json::Value> = resp.json().await?;
    let platform = detect_platform();
    let asset_name = format!("glrs-assume-{platform}");

    // Select the highest-semver matching release (not the first in API order).
    let best = releases
        .iter()
        .filter(|r| {
            r.get("tag_name")
                .and_then(|t| t.as_str())
                .map(|t| t.starts_with(TAG_PREFIX))
                .unwrap_or(false)
        })
        .max_by(|a, b| {
            let va = a.get("tag_name").and_then(|t| t.as_str()).unwrap_or("");
            let vb = b.get("tag_name").and_then(|t| t.as_str()).unwrap_or("");
            compare_versions(
                va.strip_prefix(TAG_PREFIX).unwrap_or(va),
                vb.strip_prefix(TAG_PREFIX).unwrap_or(vb),
            )
        });

    let Some(release) = best else { return Ok(None) };
    let tag = release
        .get("tag_name")
        .and_then(|t| t.as_str())
        .unwrap_or("");
    let version = tag.strip_prefix(TAG_PREFIX).unwrap_or(tag).to_string();

    let asset_url = release
        .get("assets")
        .and_then(|a| a.as_array())
        .and_then(|assets| {
            assets
                .iter()
                .find(|a| a.get("name").and_then(|n| n.as_str()) == Some(&asset_name))
        })
        .and_then(|a| a.get("browser_download_url"))
        .and_then(|u| u.as_str())
        .unwrap_or("")
        .to_string();

    Ok(Some(Release {
        version,
        tag: tag.to_string(),
        asset_url,
    }))
}

async fn download_binary(release: &Release, dest: &str) -> anyhow::Result<bool> {
    let platform = detect_platform();
    let asset_name = format!("glrs-assume-{platform}");

    // Try gh CLI first
    let tmp = format!("{dest}.tmp");
    let gh_result = std::process::Command::new("gh")
        .args([
            "release",
            "download",
            &release.tag,
            "-R",
            REPO,
            "-p",
            &asset_name,
            "-O",
            &tmp,
            "--clobber",
        ])
        .stderr(std::process::Stdio::null())
        .status();

    if let Ok(status) = gh_result {
        if status.success() {
            fs::set_permissions(&tmp, fs::Permissions::from_mode(0o755))?;
            fs::rename(&tmp, dest)?;
            return Ok(true);
        }
    }

    // Fall back to direct download
    if release.asset_url.is_empty() {
        anyhow::bail!("no download URL available and gh CLI failed");
    }

    let token = std::env::var("GITHUB_TOKEN")
        .or_else(|_| std::env::var("GH_TOKEN"))
        .ok();

    let client = reqwest::Client::new();
    let mut req = client
        .get(&release.asset_url)
        .header("User-Agent", "glrs-assume-cli")
        .header("Accept", "application/octet-stream");

    if let Some(ref tok) = token {
        req = req.header("Authorization", format!("Bearer {tok}"));
    }

    let resp = req.send().await?;
    if !resp.status().is_success() {
        anyhow::bail!("download failed: HTTP {}", resp.status());
    }

    let bytes = resp.bytes().await?;
    fs::write(&tmp, &bytes)?;
    fs::set_permissions(&tmp, fs::Permissions::from_mode(0o755))?;
    fs::rename(&tmp, dest)?;
    Ok(true)
}

/// True if the running binary lives inside a `node_modules` tree (npm install).
fn is_npm_install(exe: &std::path::Path) -> bool {
    exe.components().any(|c| c.as_os_str() == "node_modules")
}

fn recreate_alias(binary_path: &str) {
    let dir = std::path::Path::new(binary_path)
        .parent()
        .unwrap_or(std::path::Path::new("."));
    let alias_path = dir.join("gsa");
    // Remove old symlink if it exists
    let _ = fs::remove_file(&alias_path);
    let _ = std::os::unix::fs::symlink(binary_path, &alias_path);
}

pub async fn run(_args: UpgradeArgs) -> anyhow::Result<()> {
    let current = env!("CARGO_PKG_VERSION");
    eprintln!("\x1b[36m▸\x1b[0m current version: {current}");

    // Find where we're installed
    let exe_path = std::env::current_exe()?;
    let exe_path = fs::canonicalize(&exe_path)?;
    let exe_str = exe_path.to_string_lossy().to_string();
    eprintln!("\x1b[36m▸\x1b[0m installed at: {exe_str}");

    // npm installs upgrade via npm — swapping the binary inside node_modules
    // would leave it out of sync with the package manifest (and npm would revert
    // it on the next install). npm's own resolution handles "latest", so we skip
    // the GitHub-release path entirely here.
    if is_npm_install(&exe_path) {
        eprintln!("\x1b[36m▸\x1b[0m npm install detected — upgrading via npm");
        match std::process::Command::new("npm")
            .args(["install", "-g", "@glrs-dev/assume@latest"])
            .status()
        {
            Ok(s) if s.success() => {
                eprintln!("\x1b[32m✓\x1b[0m upgraded to the latest @glrs-dev/assume via npm");
                return Ok(());
            }
            Ok(_) => {
                eprintln!("\x1b[31merror:\x1b[0m `npm install -g @glrs-dev/assume@latest` failed");
                std::process::exit(1);
            }
            Err(e) => {
                eprintln!(
                    "\x1b[31merror:\x1b[0m could not run npm ({e}). Upgrade manually: npm i -g @glrs-dev/assume@latest"
                );
                std::process::exit(1);
            }
        }
    }

    eprintln!("\x1b[36m▸\x1b[0m checking for updates...");
    let latest = fetch_latest_release().await?;

    let release = match latest {
        Some(r) => r,
        None => {
            eprintln!("\x1b[33mwarning:\x1b[0m no releases found");
            std::process::exit(1);
        }
    };

    eprintln!("\x1b[36m▸\x1b[0m latest version: {}", release.version);

    if compare_versions(&release.version, current) != std::cmp::Ordering::Greater {
        eprintln!("\x1b[32m✓\x1b[0m already up to date");
        return Ok(());
    }

    // Check write permission
    let install_dir = exe_path.parent().unwrap();
    if fs::metadata(install_dir)
        .map(|m| m.permissions().readonly())
        .unwrap_or(true)
    {
        // Try writing a test file
        let test_path = install_dir.join(".glrs-assume-write-test");
        if fs::write(&test_path, "test").is_err() {
            eprintln!(
                "\x1b[31merror:\x1b[0m no write permission to {} — try with sudo",
                install_dir.display()
            );
            std::process::exit(1);
        }
        let _ = fs::remove_file(&test_path);
    }

    eprintln!("\x1b[36m▸\x1b[0m downloading v{}...", release.version);
    match download_binary(&release, &exe_str).await {
        Ok(true) => {
            recreate_alias(&exe_str);
            eprintln!("\x1b[32m✓\x1b[0m updated to v{}", release.version);
        }
        Ok(false) => {
            eprintln!("\x1b[31merror:\x1b[0m download failed");
            std::process::exit(1);
        }
        Err(e) => {
            eprintln!("\x1b[31merror:\x1b[0m {e}");
            std::process::exit(1);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cmp::Ordering;
    use std::path::Path;

    #[test]
    fn compare_versions_is_numeric_not_lexical() {
        // The bug that made `gsa upgrade` think 0.6.4 was newer than 0.10.0 was
        // string comparison ("0.10.0" < "0.6.4" lexically). Guard the numeric path.
        assert_eq!(compare_versions("0.10.0", "0.6.4"), Ordering::Greater);
        assert_eq!(compare_versions("0.10.1", "0.10.0"), Ordering::Greater);
        assert_eq!(compare_versions("0.9.0", "0.10.0"), Ordering::Less);
        assert_eq!(compare_versions("1.0.0", "1.0.0"), Ordering::Equal);
        // Differing component counts: 0.10 == 0.10.0
        assert_eq!(compare_versions("0.10", "0.10.0"), Ordering::Equal);
    }

    #[test]
    fn coordinates_point_at_the_current_repo_and_tag_format() {
        assert_eq!(REPO, "iceglober/glrs");
        assert_eq!(TAG_PREFIX, "@glrs-dev/assume@");
        // A real published tag strips to a clean semver.
        assert_eq!(
            "@glrs-dev/assume@0.10.1".strip_prefix(TAG_PREFIX),
            Some("0.10.1")
        );
    }

    #[test]
    fn detects_npm_install_by_node_modules_segment() {
        assert!(is_npm_install(Path::new(
            "/Users/x/.nvm/versions/node/v24/lib/node_modules/@glrs-dev/assume-darwin-arm64/bin/glrs-assume"
        )));
        assert!(!is_npm_install(Path::new("/usr/local/bin/glrs-assume")));
    }
}
