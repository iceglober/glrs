/// Send a desktop notification that a provider's session has expired
#[allow(dead_code)]
pub fn notify_session_expired(provider_display_name: &str) {
    let title = "gs-assume: Session Expired";
    let body = format!(
        "{} session expired. Run: gsa login {}",
        provider_display_name,
        provider_display_name.to_lowercase().replace(' ', "-")
    );

    if let Err(e) = send_notification(title, &body) {
        tracing::debug!("Failed to send desktop notification: {e}");
    }
}

/// Send a notification that credentials are about to expire
#[allow(dead_code)]
pub fn notify_expiring_soon(provider_display_name: &str, minutes_remaining: u64) {
    let title = "gs-assume: Credentials Expiring";
    let body = format!(
        "{} credentials expire in {} minutes",
        provider_display_name, minutes_remaining
    );

    if let Err(e) = send_notification(title, &body) {
        tracing::debug!("Failed to send desktop notification: {e}");
    }
}

/// Send a notification for a successful context switch
#[allow(dead_code)]
pub fn notify_context_switch(provider_display_name: &str, context_name: &str) {
    let title = "gs-assume: Context Switched";
    let body = format!("Switched to {} [{}]", context_name, provider_display_name);

    if let Err(e) = send_notification(title, &body) {
        tracing::debug!("Failed to send desktop notification: {e}");
    }
}

#[allow(dead_code)]
fn send_notification(title: &str, body: &str) -> Result<(), notify_rust::error::Error> {
    notify_rust::Notification::new()
        .summary(title)
        .body(body)
        .appname("gs-assume")
        .show()?;
    Ok(())
}
