use std::fs;
use std::path::PathBuf;

const REPO: &str = "iceglober/glorious";
const TAG_PREFIX: &str = "assume-v";
const CACHE_TTL_SECS: u64 = 24 * 60 * 60; // 24 hours

#[derive(serde::Serialize, serde::Deserialize)]
struct CachedVersion {
    version: String,
    checked_at: u64,
}

fn cache_path() -> PathBuf {
    let cache_dir = dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("glorious-assume");
    cache_dir.join("latest-version.json")
}

fn read_cache() -> Option<String> {
    let path = cache_path();
    let data = fs::read_to_string(&path).ok()?;
    let cached: CachedVersion = serde_json::from_str(&data).ok()?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs();

    if now - cached.checked_at < CACHE_TTL_SECS {
        Some(cached.version)
    } else {
        None // expired
    }
}

fn write_cache(version: &str) {
    let path = cache_path();
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let cached = CachedVersion {
        version: version.to_string(),
        checked_at: now,
    };
    let _ = fs::write(&path, serde_json::to_string(&cached).unwrap_or_default());
}

/// Fetch latest version using gh CLI (sync, fast)
fn fetch_latest_version_gh() -> Option<String> {
    let output = std::process::Command::new("gh")
        .args([
            "release", "list", "-R", REPO, "--json", "tagName", "-L", "10",
        ])
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8(output.stdout).ok()?;
    let releases: Vec<serde_json::Value> = serde_json::from_str(&stdout).ok()?;

    releases.iter().find_map(|r| {
        let tag = r.get("tagName")?.as_str()?;
        tag.strip_prefix(TAG_PREFIX).map(|v| v.to_string())
    })
}

/// Fetch latest version using GitHub REST API via curl (avoids nested tokio runtime)
fn fetch_latest_version_api() -> Option<String> {
    let token = std::env::var("GITHUB_TOKEN")
        .or_else(|_| std::env::var("GH_TOKEN"))
        .ok();

    let mut cmd = std::process::Command::new("curl");
    cmd.args([
        "-fsSL",
        "--max-time",
        "5",
        "-H",
        "Accept: application/vnd.github+json",
        "-H",
        "User-Agent: gs-assume-cli",
        "-H",
        "X-GitHub-Api-Version: 2022-11-28",
    ]);
    if let Some(ref tok) = token {
        cmd.args(["-H", &format!("Authorization: Bearer {tok}")]);
    }
    cmd.arg(format!(
        "https://api.github.com/repos/{REPO}/releases?per_page=10"
    ));
    cmd.stderr(std::process::Stdio::null());

    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8(output.stdout).ok()?;
    let releases: Vec<serde_json::Value> = serde_json::from_str(&stdout).ok()?;
    releases.iter().find_map(|r| {
        let tag = r.get("tag_name")?.as_str()?;
        tag.strip_prefix(TAG_PREFIX).map(|v| v.to_string())
    })
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

/// Check for updates and print a notice if a newer version is available.
/// Never panics or returns errors — all failures are silently swallowed.
/// This is called early in main() for every CLI invocation.
pub fn check_for_update() {
    // Catch everything — never crash the CLI for a version check
    let _ = std::panic::catch_unwind(|| {
        let current = env!("CARGO_PKG_VERSION");

        let latest = if let Some(cached) = read_cache() {
            cached
        } else {
            // Try gh CLI first (fast), then REST API
            let fetched = fetch_latest_version_gh().or_else(fetch_latest_version_api);
            match fetched {
                Some(v) => {
                    write_cache(&v);
                    v
                }
                None => return,
            }
        };

        if compare_versions(&latest, current) != std::cmp::Ordering::Greater {
            return;
        }

        eprintln!(
            "\x1b[33mwarning:\x1b[0m Update available: gs-assume v{latest} (current: v{current}). Run `gsa upgrade` to update."
        );
    });
}
