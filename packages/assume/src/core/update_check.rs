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

/// Fetch latest version from the public GitHub API via curl.
/// Uses a 3-second timeout so it never blocks the CLI.
fn fetch_latest_version() -> Option<String> {
    let output = std::process::Command::new("curl")
        .args([
            "-fsSL",
            "--max-time",
            "3",
            "-H",
            "Accept: application/vnd.github+json",
            "-H",
            "User-Agent: gs-assume-cli",
            "-H",
            "X-GitHub-Api-Version: 2022-11-28",
        ])
        .arg(format!(
            "https://api.github.com/repos/{REPO}/releases?per_page=10"
        ))
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;

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

fn is_major_bump(current: &str, latest: &str) -> bool {
    let cur_major: u64 = current
        .split('.')
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let lat_major: u64 = latest
        .split('.')
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    lat_major > cur_major
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
    match (os, arch) {
        ("darwin", "arm64") => "darwin-arm64",
        ("darwin", "amd64") => "darwin-amd64",
        ("linux", "arm64") => "linux-arm64",
        _ => "linux-amd64",
    }
}

/// Attempt to download and replace the running binary. Returns true on success.
fn try_auto_upgrade(tag: &str) -> bool {
    let exe_path = match std::env::current_exe().and_then(fs::canonicalize) {
        Ok(p) => p,
        Err(_) => return false,
    };

    let install_dir = match exe_path.parent() {
        Some(d) => d,
        None => return false,
    };

    // Check write permission
    if fs::metadata(install_dir)
        .map(|m| m.permissions().readonly())
        .unwrap_or(true)
    {
        let test_path = install_dir.join(".gs-assume-write-test");
        if fs::write(&test_path, "test").is_err() {
            return false;
        }
        let _ = fs::remove_file(&test_path);
    }

    let platform = detect_platform();
    let asset_name = format!("gs-assume-{platform}");
    let tmp = format!("{}.tmp", exe_path.to_string_lossy());

    // Download binary from public GitHub release via curl
    let download_url = format!("https://github.com/{REPO}/releases/download/{tag}/{asset_name}");
    let result = std::process::Command::new("curl")
        .args(["-fsSL", "--max-time", "30", "-o", &tmp, &download_url])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();

    match result {
        Ok(status) if status.success() => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(0o755));
            }
            // Clear quarantine xattrs so macOS doesn't kill the binary
            #[cfg(target_os = "macos")]
            {
                let _ = std::process::Command::new("xattr")
                    .args(["-cr", &tmp])
                    .status();
            }
            if fs::rename(&tmp, &exe_path).is_ok() {
                return true;
            }
            let _ = fs::remove_file(&tmp);
            false
        }
        _ => {
            let _ = fs::remove_file(&tmp);
            false
        }
    }
}

/// Re-exec the current process so the just-upgraded binary handles the command.
fn re_exec() -> ! {
    let exe = std::env::current_exe().expect("cannot resolve current exe");
    let args: Vec<String> = std::env::args().collect();
    let err = exec::execvp(&exe, &args);
    // exec only returns on error
    eprintln!("\x1b[33mwarning:\x1b[0m failed to re-exec after upgrade: {err}");
    std::process::exit(1);
}

/// Check for updates. Auto-upgrades minor/patch, warns for major.
/// Never panics or returns errors — all failures are silently swallowed.
/// This is called early in main() for every CLI invocation.
pub fn check_for_update() {
    // Catch everything — never crash the CLI for a version check
    let _ = std::panic::catch_unwind(|| {
        let current = env!("CARGO_PKG_VERSION");

        let latest = if let Some(cached) = read_cache() {
            cached
        } else {
            // No cache — fetch from public API (curl with 3s timeout)
            let handle = std::thread::spawn(fetch_latest_version);

            // Wait at most 3 seconds for the version check
            match handle.join() {
                Ok(Some(v)) => {
                    write_cache(&v);
                    v
                }
                _ => return,
            }
        };

        if compare_versions(&latest, current) != std::cmp::Ordering::Greater {
            return;
        }

        if is_major_bump(current, &latest) {
            eprintln!(
                "\x1b[33mwarning:\x1b[0m gs-assume v{latest} available (major update) — run `gsa upgrade` to update"
            );
            return;
        }

        // Auto-upgrade for minor/patch
        let tag = format!("{TAG_PREFIX}{latest}");
        eprintln!("\x1b[36m▸\x1b[0m updating gs-assume v{current} → v{latest}...");
        if try_auto_upgrade(&tag) {
            eprintln!("\x1b[32m✓\x1b[0m updated to v{latest}");
            write_cache(&latest);
            re_exec();
        } else {
            eprintln!(
                "\x1b[33mwarning:\x1b[0m gs-assume v{latest} available — run `gsa upgrade` to update"
            );
        }
    });
}
