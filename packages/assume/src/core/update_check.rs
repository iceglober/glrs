use std::fs;
use std::path::PathBuf;

// Post-monorepo (Apr 2026): releases cut by Changesets on iceglober/glrs
// with per-package tags like "@glrs-dev/assume@0.6.4". The pre-monorepo
// tag format "assume-v0.6.3" on iceglober/glorious is frozen — any
// gs-assume installed before the monorepo migration hits this path on
// its next run and auto-migrates to the new update channel.
const REPO: &str = "iceglober/glrs";
const TAG_PREFIX: &str = "@glrs-dev/assume@";
const CACHE_TTL_SECS: u64 = 24 * 60 * 60; // 24 hours

#[derive(serde::Serialize, serde::Deserialize)]
struct CachedVersion {
    version: String,
    checked_at: u64,
}

fn cache_path() -> PathBuf {
    let cache_dir = dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("gs-assume");
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
/// Uses a 3-second timeout so it never blocks the CLI noticeably.
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
        tracing::debug!("update check: curl failed with status {}", output.status);
        return None;
    }

    let stdout = String::from_utf8(output.stdout).ok()?;
    let releases: Vec<serde_json::Value> = serde_json::from_str(&stdout).ok()?;
    // Find the first release whose tag matches the main package's tag
    // prefix exactly. Changesets cuts separate releases for the main
    // package and each platform sibling:
    //   @glrs-dev/assume@0.6.4          ← main (this is what we want)
    //   @glrs-dev/assume-darwin-arm64@0.6.4
    //   @glrs-dev/assume-linux-x64@0.6.4
    //   ...
    // strip_prefix is exact-match on the boundary '@' after "assume", so
    // platform tags (which have '-' there, not '@') are naturally excluded.
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

/// Minimal percent-encoder for git tag names used in GitHub release URLs.
/// Encodes only `@` and `/` — the two characters Changesets' tag format
/// (`@glrs-dev/assume@<version>`) introduces that collide with URL path
/// semantics. Pulled out as a standalone helper so the test matrix is
/// explicit about which chars round-trip vs which get escaped.
fn url_encode_tag(tag: &str) -> String {
    let mut out = String::with_capacity(tag.len() + 8);
    for ch in tag.chars() {
        match ch {
            '@' => out.push_str("%40"),
            '/' => out.push_str("%2F"),
            _ => out.push(ch),
        }
    }
    out
}

/// Attempt to download and replace the running binary. Returns true on success.
/// Tries `gh release download` first, then falls back to `curl`.
fn try_auto_upgrade(tag: &str) -> bool {
    let exe_path = match std::env::current_exe().and_then(fs::canonicalize) {
        Ok(p) => p,
        Err(e) => {
            tracing::debug!("auto-upgrade: cannot resolve exe path: {e}");
            return false;
        }
    };

    let install_dir = match exe_path.parent() {
        Some(d) => d,
        None => return false,
    };

    // Check write permission
    let test_path = install_dir.join(".gs-assume-write-test");
    if fs::write(&test_path, "test").is_err() {
        tracing::debug!(
            "auto-upgrade: no write permission to {}",
            install_dir.display()
        );
        return false;
    }
    let _ = fs::remove_file(&test_path);

    let platform = detect_platform();
    let asset_name = format!("gs-assume-{platform}");
    let tmp = format!("{}.tmp", exe_path.to_string_lossy());

    // Percent-encode the tag for the URL path. Changesets tags include '@'
    // and '/' (e.g. "@glrs-dev/assume@0.6.4") which must be URL-escaped or
    // GitHub's release-download endpoint routes incorrectly.
    let encoded_tag = url_encode_tag(tag);
    let download_url =
        format!("https://github.com/{REPO}/releases/download/{encoded_tag}/{asset_name}");
    let result = std::process::Command::new("curl")
        .args(["-fsSL", "--max-time", "30", "-o", &tmp, &download_url])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();

    let downloaded = match result {
        Ok(status) if status.success() => true,
        Ok(status) => {
            tracing::debug!("auto-upgrade: curl download failed with status {status}");
            let _ = fs::remove_file(&tmp);
            false
        }
        Err(e) => {
            tracing::debug!("auto-upgrade: curl not available: {e}");
            let _ = fs::remove_file(&tmp);
            false
        }
    };

    if !downloaded {
        return false;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(0o755));
    }
    // Clear quarantine xattrs and ad-hoc sign so macOS doesn't block the binary.
    // Directories under ~/.local/ inherit com.apple.provenance which causes unsigned
    // binaries to hang on launch.
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("xattr")
            .args(["-cr", &tmp])
            .status();
        let _ = std::process::Command::new("codesign")
            .args(["-s", "-", &tmp])
            .status();
    }
    if fs::rename(&tmp, &exe_path).is_ok() {
        return true;
    }
    tracing::debug!("auto-upgrade: rename failed");
    let _ = fs::remove_file(&tmp);
    false
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
        tracing::debug!("update check: current version {current}");

        let latest = if let Some(cached) = read_cache() {
            // If cached version is older than current, cache is stale — re-fetch
            if compare_versions(&cached, current) == std::cmp::Ordering::Less {
                tracing::debug!("update check: cached {cached} < current {current}, re-fetching");
                let _ = fs::remove_file(cache_path());
                let handle = std::thread::spawn(fetch_latest_version);
                match handle.join() {
                    Ok(Some(v)) => {
                        tracing::debug!("update check: re-fetched version {v}");
                        write_cache(&v);
                        v
                    }
                    _ => return,
                }
            } else {
                tracing::debug!("update check: cached version {cached}");
                cached
            }
        } else {
            tracing::debug!("update check: no cache, fetching from API");
            let handle = std::thread::spawn(fetch_latest_version);

            match handle.join() {
                Ok(Some(v)) => {
                    tracing::debug!("update check: fetched version {v}");
                    write_cache(&v);
                    v
                }
                Ok(None) => {
                    tracing::debug!("update check: fetch returned None");
                    return;
                }
                Err(_) => {
                    tracing::debug!("update check: fetch thread panicked");
                    return;
                }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_encode_tag_escapes_at_and_slash() {
        assert_eq!(
            url_encode_tag("@glrs-dev/assume@0.6.4"),
            "%40glrs-dev%2Fassume%400.6.4"
        );
    }

    #[test]
    fn url_encode_tag_leaves_unreserved_chars_alone() {
        assert_eq!(url_encode_tag("0.6.4"), "0.6.4");
        assert_eq!(url_encode_tag("v1.2.3-beta.1"), "v1.2.3-beta.1");
    }

    #[test]
    fn url_encode_tag_round_trips_legacy_format() {
        // Legacy pre-monorepo format (`assume-v*`) has no chars that need
        // escaping — important during the transition window where an
        // installed pre-monorepo binary still reads old tag names.
        assert_eq!(url_encode_tag("assume-v0.6.3"), "assume-v0.6.3");
    }

    fn parse_version_from_releases(json: &str) -> Option<String> {
        let releases: Vec<serde_json::Value> = serde_json::from_str(json).ok()?;
        releases.iter().find_map(|r| {
            let tag = r.get("tag_name")?.as_str()?;
            tag.strip_prefix(TAG_PREFIX).map(|v| v.to_string())
        })
    }

    #[test]
    fn tag_filter_picks_main_package_not_platform_siblings() {
        // Simulate the Changesets-produced release set: main package plus
        // each platform sibling. The filter must pick ONLY the main package.
        let json = r#"[
            {"tag_name": "@glrs-dev/assume-darwin-arm64@0.6.4"},
            {"tag_name": "@glrs-dev/assume@0.6.4"},
            {"tag_name": "@glrs-dev/assume-linux-x64@0.6.4"}
        ]"#;
        assert_eq!(parse_version_from_releases(json), Some("0.6.4".to_string()));
    }

    #[test]
    fn tag_filter_rejects_platform_only_releases() {
        // Hypothetical: only platform releases exist, main is absent.
        // Filter should return None (not accidentally strip a platform tag).
        let json = r#"[
            {"tag_name": "@glrs-dev/assume-darwin-arm64@0.6.4"},
            {"tag_name": "@glrs-dev/assume-linux-x64@0.6.4"}
        ]"#;
        assert_eq!(parse_version_from_releases(json), None);
    }

    #[test]
    fn tag_filter_ignores_unrelated_releases() {
        // Other packages in the monorepo (cli, harness-plugin-opencode)
        // produce their own Changesets tags on the same repo. The filter
        // must ignore them.
        let json = r#"[
            {"tag_name": "@glrs-dev/cli@0.3.2"},
            {"tag_name": "@glrs-dev/harness-plugin-opencode@0.3.2"},
            {"tag_name": "@glrs-dev/assume@0.6.4"}
        ]"#;
        assert_eq!(parse_version_from_releases(json), Some("0.6.4".to_string()));
    }
}
