//! Out-of-band re-auth coordination. When a provider's session lapses (AWS SSO
//! ended, GCP `invalid_rapt` reauth window closed), the daemon can open a browser
//! itself to recover — instead of only flagging needs-login and asking a human to
//! run `gsa login` by hand. This module is the small bit of shared state that
//! keeps that from firing a browser on every 60s refresh tick.

use crate::core::config::Config;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Minimum gap between auto-reauth attempts for the same provider. A user who
/// dismisses the browser (or whose sign-in fails) is not re-prompted every tick;
/// the daemon waits this long before opening another browser.
const COOLDOWN: Duration = Duration::from_secs(300);

struct ReauthState {
    in_progress: bool,
    last_attempt: Option<Instant>,
}

fn registry() -> &'static Mutex<HashMap<String, ReauthState>> {
    static R: OnceLock<Mutex<HashMap<String, ReauthState>>> = OnceLock::new();
    R.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Whether the daemon is allowed to drive an interactive browser re-auth for this
/// provider. Reads `[providers.<id>] auto_reauth` (default true). Set it to false
/// to keep the old behaviour (flag needs-login + notify, but never pop a browser).
pub fn auto_reauth_enabled(config: &Config, provider_id: &str) -> bool {
    config
        .providers
        .get(provider_id)
        .and_then(|p| p.extra.get("auto_reauth"))
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
}

/// Try to claim the right to run an out-of-band reauth for `provider_id`. Returns
/// true only if no reauth is already running for it and the cooldown has elapsed.
/// The caller MUST call [`finish`] when its attempt completes.
pub fn try_begin(provider_id: &str) -> bool {
    let mut map = registry().lock().unwrap();
    let st = map.entry(provider_id.to_string()).or_insert(ReauthState {
        in_progress: false,
        last_attempt: None,
    });
    if st.in_progress {
        return false;
    }
    if let Some(t) = st.last_attempt {
        if t.elapsed() < COOLDOWN {
            return false;
        }
    }
    st.in_progress = true;
    st.last_attempt = Some(Instant::now());
    true
}

/// Release the claim taken by [`try_begin`], stamping the completion time so the
/// cooldown is measured from when the attempt ended (not when it started).
pub fn finish(provider_id: &str) {
    let mut map = registry().lock().unwrap();
    if let Some(st) = map.get_mut(provider_id) {
        st.in_progress = false;
        st.last_attempt = Some(Instant::now());
    }
}

/// Whether an out-of-band reauth is currently running for this provider. Used by
/// the MCP tool to tell an agent "it's being handled, keep polling" rather than
/// "a human must act."
pub fn in_progress(provider_id: &str) -> bool {
    registry()
        .lock()
        .unwrap()
        .get(provider_id)
        .map(|st| st.in_progress)
        .unwrap_or(false)
}
