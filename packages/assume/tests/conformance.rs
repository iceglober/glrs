//! Plugin conformance test suite.
//! Tests that built-in providers satisfy the Provider trait contract.

// Note: These tests validate the trait contract statically.
// Full lifecycle tests against mock servers go in integration.rs.

/// Validate that a provider ID matches the required format: ^[a-z][a-z0-9_-]{0,31}$
fn is_valid_id(id: &str) -> bool {
    if id.is_empty() || id.len() > 32 {
        return false;
    }
    let bytes = id.as_bytes();
    if !bytes[0].is_ascii_lowercase() {
        return false;
    }
    bytes[1..]
        .iter()
        .all(|&b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
}

#[cfg(test)]
mod aws_conformance {
    use super::*;
    use assume::plugin::{Provider, ProviderConfig};
    use assume::providers::aws::AwsProvider;

    fn make_provider() -> AwsProvider {
        let config = ProviderConfig::default();
        AwsProvider::from_config(&config)
    }

    #[test]
    fn test_trait_version() {
        let p = make_provider();
        assert_eq!(
            p.trait_version(),
            1,
            "AWS provider must return trait version 1"
        );
    }

    #[test]
    fn test_id_format() {
        let p = make_provider();
        let id = p.id();
        assert!(
            is_valid_id(id),
            "Provider ID '{id}' must match ^[a-z][a-z0-9_-]{{0,31}}$"
        );
        assert_eq!(id, "aws");
    }

    #[test]
    fn test_display_name_non_empty() {
        let p = make_provider();
        assert!(
            !p.display_name().is_empty(),
            "display_name must not be empty"
        );
    }

    #[test]
    fn test_shell_env_non_empty() {
        let p = make_provider();
        let env = p.shell_env(9911);
        assert!(!env.is_empty(), "shell_env must return at least one entry");
        for entry in &env {
            assert!(!entry.0.is_empty(), "env var key must not be empty");
            assert!(!entry.1.is_empty(), "env var value must not be empty");
        }
    }

    #[test]
    fn test_credential_endpoint() {
        let p = make_provider();
        let ep = p.credential_endpoint();
        assert!(ep.port > 0, "endpoint port must be > 0");
        assert!(!ep.path.is_empty(), "endpoint path must not be empty");
    }

    #[test]
    fn test_refresh_schedule_valid() {
        let p = make_provider();
        let sched = p.refresh_schedule();
        assert!(
            !sched.check_interval.is_zero(),
            "check_interval must be non-zero"
        );
        assert!(
            !sched.refresh_buffer.is_zero(),
            "refresh_buffer must be non-zero"
        );
        assert!(
            !sched.credential_ttl.is_zero(),
            "credential_ttl must be non-zero"
        );
        assert!(
            sched.refresh_buffer < sched.credential_ttl,
            "refresh_buffer ({:?}) must be < credential_ttl ({:?})",
            sched.refresh_buffer,
            sched.credential_ttl
        );
    }

    #[test]
    fn test_prompt_segment_non_empty() {
        let p = make_provider();
        let ctx = assume::plugin::Context {
            provider_id: "aws".into(),
            id: "111111111111/AdminAccess".into(),
            display_name: "prod-account / AdminAccess".into(),
            searchable_fields: vec!["prod-account".into()],
            tags: vec![],
            metadata: std::collections::HashMap::from([
                ("account_name".into(), "prod-account".into()),
                ("role_name".into(), "AdminAccess".into()),
            ]),
            region: "us-east-1".into(),
        };
        let seg = p.prompt_segment(&ctx);
        assert!(
            !seg.text.is_empty(),
            "prompt segment text must not be empty"
        );
        assert!(
            !seg.color.is_empty(),
            "prompt segment color must not be empty"
        );
    }
}

#[cfg(test)]
mod gcp_conformance {
    use super::*;
    use assume::plugin::Provider;
    use assume::providers::gcp::GcpProvider;

    #[test]
    fn test_trait_version() {
        let p = GcpProvider::new();
        assert_eq!(p.trait_version(), 1);
    }

    #[test]
    fn test_id_format() {
        let p = GcpProvider::new();
        assert!(is_valid_id(p.id()));
        assert_eq!(p.id(), "gcp");
    }

    #[test]
    fn test_not_daemon_served() {
        // GCP delegates credential delivery to gcloud's ADC, so it binds no
        // daemon endpoint and exports no ambient endpoint env.
        let p = GcpProvider::new();
        assert!(!p.is_daemon_served());
        assert!(p.shell_env(9912).is_empty());
    }

    #[test]
    fn test_refresh_schedule_valid() {
        let p = GcpProvider::new();
        let sched = p.refresh_schedule();
        assert!(!sched.check_interval.is_zero());
        assert!(sched.refresh_buffer < sched.credential_ttl);
    }
}

#[cfg(test)]
mod command_conformance {
    /// Every cli command module that accesses credential or daemon APIs
    /// must declare `pub const REQUIREMENT: DaemonRequirement` with a non-None value.
    ///
    /// This test dynamically scans `src/cli/*.rs` — adding a new module that touches
    /// credentials without declaring REQUIREMENT will fail this test automatically.
    /// The exhaustive match in main.rs gives compile-time enforcement that every
    /// Commands variant maps to a REQUIREMENT; this test verifies the values are correct.
    #[test]
    fn credential_modules_must_declare_daemon_requirement() {
        // Source patterns that indicate a module depends on the credential daemon.
        // These are daemon-specific APIs — NOT general token/credential access
        // (many commands read tokens for display without needing the daemon).
        let daemon_indicators = [
            "ensure_daemon_running",
            "validate_credential_endpoint",
            "restart_daemon",
        ];

        // Modules that are exempt from this check because they manage the daemon
        // lifecycle themselves (serve IS the daemon; login restarts it after auth).
        let self_managed: &[&str] = &["serve", "login"];

        let cli_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/cli");
        let mut checked = 0;
        let mut violations = Vec::new();

        for entry in std::fs::read_dir(&cli_dir).expect("src/cli/ must exist") {
            let path = entry.unwrap().path();
            if path.extension().and_then(|e| e.to_str()) != Some("rs") {
                continue;
            }
            let module_name = path.file_stem().unwrap().to_str().unwrap().to_string();
            if module_name == "mod" {
                continue;
            }
            if self_managed.contains(&module_name.as_str()) {
                continue;
            }

            let source = std::fs::read_to_string(&path).unwrap();
            let uses_daemon = daemon_indicators
                .iter()
                .any(|pattern| source.contains(pattern));

            if uses_daemon {
                checked += 1;

                // Must declare a REQUIREMENT constant
                if !source.contains("pub const REQUIREMENT: DaemonRequirement") {
                    violations.push(format!(
                        "cli/{module_name}.rs uses daemon APIs but does not declare \
                         `pub const REQUIREMENT: DaemonRequirement`"
                    ));
                    continue;
                }

                // Must not be DaemonRequirement::None
                if source.contains("DaemonRequirement::None") {
                    violations.push(format!(
                        "cli/{module_name}.rs uses daemon APIs but declares \
                         DaemonRequirement::None — should be DaemonRequirement::Daemon"
                    ));
                }
            }
        }

        assert!(
            checked > 0,
            "Sanity check failed: no daemon-using cli modules found. \
             Did the daemon_indicators list become stale?"
        );

        if !violations.is_empty() {
            panic!(
                "Command daemon-requirement conformance failures:\n  - {}",
                violations.join("\n  - ")
            );
        }
    }

    /// Every cli module in src/cli/ must declare `pub const REQUIREMENT: DaemonRequirement`.
    /// This catches modules that don't use credentials but also forgot the constant —
    /// without it, the exhaustive match in main.rs can't reference the module's requirement.
    #[test]
    fn all_command_modules_declare_requirement() {
        let cli_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/cli");
        let mut missing = Vec::new();

        for entry in std::fs::read_dir(&cli_dir).expect("src/cli/ must exist") {
            let path = entry.unwrap().path();
            if path.extension().and_then(|e| e.to_str()) != Some("rs") {
                continue;
            }
            let module_name = path.file_stem().unwrap().to_str().unwrap().to_string();
            if module_name == "mod" {
                continue;
            }

            let source = std::fs::read_to_string(&path).unwrap();
            if !source.contains("pub const REQUIREMENT: DaemonRequirement") {
                missing.push(module_name);
            }
        }

        if !missing.is_empty() {
            panic!(
                "The following cli modules are missing \
                 `pub const REQUIREMENT: DaemonRequirement`:\n  - {}\n\
                 Every command module must declare this constant so that main.rs \
                 can enforce daemon lifecycle at compile time.",
                missing.join("\n  - ")
            );
        }
    }

    /// Verify that `exec` and `credential_process` declare `BackgroundEnsure`
    /// (non-blocking daemon spawn) rather than `None` or `Daemon`.
    ///
    /// These commands load tokens from keychain directly and must not block on
    /// daemon startup, but they should opportunistically restart the daemon so
    /// future refresh ticks keep tokens alive.
    #[test]
    fn daemon_requirement_classification() {
        use assume::core::daemon::DaemonRequirement;

        assert_eq!(
            assume::cli::exec::REQUIREMENT,
            DaemonRequirement::BackgroundEnsure,
            "exec must use BackgroundEnsure — it should opportunistically restart \
             the daemon without blocking command execution"
        );

        assert_eq!(
            assume::cli::credential_process::REQUIREMENT,
            DaemonRequirement::BackgroundEnsure,
            "credential_process must use BackgroundEnsure — it is called repeatedly \
             by AWS CLI/SDK and must not block on daemon startup"
        );

        assert_eq!(
            assume::cli::status::REQUIREMENT,
            DaemonRequirement::BackgroundEnsure,
            "status must use BackgroundEnsure — running status should restart \
             a dead daemon so ongoing refresh resumes"
        );

        assert_eq!(
            assume::cli::shell_init::REQUIREMENT,
            DaemonRequirement::BackgroundEnsure,
            "shell_init must use BackgroundEnsure — every new terminal should \
             ensure the daemon is running for background token refresh"
        );
    }

    #[test]
    fn launchd_plist_uses_glrs_assume_label() {
        let plist = assume::core::daemon::generate_launchd_plist("/usr/local/bin/glrs-assume");
        assert!(
            plist.contains("com.glorious.glrs-assume"),
            "launchd plist label must be com.glorious.glrs-assume"
        );
        assert!(
            !plist.contains("gs-assume"),
            "launchd plist must not contain old gs-assume name"
        );
    }

    #[test]
    fn launchd_plist_prevents_app_nap() {
        let plist = assume::core::daemon::generate_launchd_plist("/usr/local/bin/glrs-assume");
        assert!(
            plist.contains("<key>ProcessType</key>") && plist.contains("Background"),
            "launchd plist must set ProcessType=Background to prevent App Nap \
             from suspending the refresh loop"
        );
    }

    #[test]
    fn launchd_plist_only_restarts_on_crash() {
        let plist = assume::core::daemon::generate_launchd_plist("/usr/local/bin/glrs-assume");
        assert!(
            plist.contains("<key>SuccessfulExit</key>"),
            "launchd plist must use KeepAlive.SuccessfulExit=false instead of \
             blanket KeepAlive=true to avoid the 10-second respawn polling loop"
        );
    }
}
