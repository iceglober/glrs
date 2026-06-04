use crate::plugin::PromptSegment;

/// Format a prompt segment for shell display with ANSI colors.
pub fn format_segment(segment: &PromptSegment) -> String {
    let color_code = color_to_ansi(&segment.color);
    let reset = "\x1b[0m";
    format!("{color_code}[{text}]{reset}", text = segment.text)
}

/// Format multiple prompt segments (one per active provider).
pub fn format_prompt(segments: &[PromptSegment]) -> String {
    segments
        .iter()
        .map(format_segment)
        .collect::<Vec<_>>()
        .join(" ")
}

fn color_to_ansi(color: &str) -> &'static str {
    match color {
        "red" => "\x1b[31m",
        "green" => "\x1b[32m",
        "yellow" => "\x1b[33m",
        "blue" => "\x1b[34m",
        "magenta" => "\x1b[35m",
        "cyan" => "\x1b[36m",
        "white" => "\x1b[37m",
        "bright_red" => "\x1b[91m",
        "bright_green" => "\x1b[92m",
        "bright_yellow" => "\x1b[93m",
        _ => "\x1b[0m", // default/reset
    }
}

// ---- GLRS_ASSUME_SEGMENTS: per-provider prompt state, encoded for the shell ----
//
// The shell prompt renders one bracket per provider with zero subprocess spawns
// by reading a single env var, `GLRS_ASSUME_SEGMENTS`. It holds one space-joined
// token per provider, each `provider:label:color:override` (override is 0/1):
//
//     aws:dev:green:0 gcp:my-proj:blue:0
//
// `gsa use` (per-shell override) and `gsa login` (default) merge their provider's
// token into the value inherited from the calling shell; `gsa shell-init` seeds it
// from the machine-global defaults at shell start. The shell decodes and renders
// it, mapping the color name to ANSI itself so the wrapping markers stay
// shell-correct (`%{ %}` in zsh, `\[ \]` in bash).

/// One provider's prompt segment, before shell rendering.
pub struct Segment {
    pub provider: String,
    pub label: String,
    pub color: String,
    /// True when set by a per-shell `gsa use` rather than the machine default.
    pub is_override: bool,
}

/// Keep prompt labels to a delimiter-safe charset (alnum plus `-_./`). Anything
/// else — including the `:` and space we use as delimiters — becomes `-`, so an
/// account name with spaces can't corrupt the encoding.
pub fn sanitize_label(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/') {
                c
            } else {
                '-'
            }
        })
        .collect()
}

/// Encode a single segment as `provider:label:color:override`.
pub fn encode_segment(seg: &Segment) -> String {
    format!(
        "{}:{}:{}:{}",
        seg.provider,
        sanitize_label(&seg.label),
        seg.color,
        if seg.is_override { 1 } else { 0 }
    )
}

/// Split an encoded value into `(provider, token)` pairs, preserving order.
fn parse_segments(existing: &str) -> Vec<(String, String)> {
    existing
        .split_whitespace()
        .filter_map(|tok| {
            tok.split(':')
                .next()
                .map(|p| (p.to_string(), tok.to_string()))
        })
        .collect()
}

/// Merge `seg` into an inherited encoded value: replace the same provider's token
/// in place, else append. Other providers' segments are preserved untouched, so a
/// per-shell `gsa use aws prod` leaves the GCP segment alone.
pub fn merge_segment(existing: &str, seg: &Segment) -> String {
    let token = encode_segment(seg);
    let mut found = false;
    let mut out: Vec<String> = parse_segments(existing)
        .into_iter()
        .map(|(p, t)| {
            if p == seg.provider {
                found = true;
                token.clone()
            } else {
                t
            }
        })
        .collect();
    if !found {
        out.push(token);
    }
    out.join(" ")
}

/// Drop a provider's segment from an inherited encoded value.
pub fn remove_segment(existing: &str, provider_id: &str) -> String {
    parse_segments(existing)
        .into_iter()
        .filter(|(p, _)| p != provider_id)
        .map(|(_, t)| t)
        .collect::<Vec<_>>()
        .join(" ")
}

/// The `GLRS_ASSUME_SEGMENTS` inherited from the calling shell (empty when unset).
/// `gsa use`/`login` run inside the shell wrapper, so they see the live value.
pub fn current_segments_env() -> String {
    std::env::var("GLRS_ASSUME_SEGMENTS").unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_segment() {
        let seg = PromptSegment {
            text: "aws:dev/deploy".into(),
            color: "green".into(),
        };
        let result = format_segment(&seg);
        assert!(result.contains("aws:dev/deploy"));
        assert!(result.contains("\x1b[32m")); // green
        assert!(result.contains("\x1b[0m")); // reset
    }

    #[test]
    fn test_format_multiple_segments() {
        let segments = vec![
            PromptSegment {
                text: "aws:dev".into(),
                color: "green".into(),
            },
            PromptSegment {
                text: "gcp:my-project".into(),
                color: "blue".into(),
            },
        ];
        let result = format_prompt(&segments);
        assert!(result.contains("aws:dev"));
        assert!(result.contains("gcp:my-project"));
    }

    #[test]
    fn sanitize_strips_delimiters() {
        assert_eq!(sanitize_label("dev"), "dev");
        assert_eq!(sanitize_label("prod/admin"), "prod/admin");
        assert_eq!(sanitize_label("my account:1"), "my-account-1");
    }

    #[test]
    fn merge_replaces_same_provider_in_place() {
        let seg = Segment {
            provider: "aws".into(),
            label: "prod".into(),
            color: "red".into(),
            is_override: true,
        };
        let out = merge_segment("aws:dev:green:0 gcp:proj:blue:0", &seg);
        assert_eq!(out, "aws:prod:red:1 gcp:proj:blue:0");
    }

    #[test]
    fn merge_appends_new_provider() {
        let seg = Segment {
            provider: "gcp".into(),
            label: "proj".into(),
            color: "blue".into(),
            is_override: false,
        };
        assert_eq!(
            merge_segment("aws:dev:green:0", &seg),
            "aws:dev:green:0 gcp:proj:blue:0"
        );
    }

    #[test]
    fn remove_drops_only_that_provider() {
        assert_eq!(
            remove_segment("aws:dev:green:0 gcp:proj:blue:0", "aws"),
            "gcp:proj:blue:0"
        );
        assert_eq!(remove_segment("aws:dev:green:0", "aws"), "");
    }
}
