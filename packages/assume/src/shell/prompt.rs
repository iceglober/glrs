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

/// Generate the shell function that produces the prompt string.
/// Called by `gs-assume shell-init`.
pub fn prompt_function(shell: &str) -> String {
    match shell {
        "bash" => r#"
_gs_assume_prompt() {
    local segments
    segments=$(gs-assume status --prompt 2>/dev/null)
    if [ -n "$segments" ]; then
        echo "$segments "
    fi
}
if [[ "$PS1" != *'$(_gs_assume_prompt)'* ]]; then
    PS1='$(_gs_assume_prompt)'"$PS1"
fi
"#
        .to_string(),
        "zsh" => r#"
_gs_assume_prompt() {
    local segments
    segments=$(gs-assume status --prompt 2>/dev/null)
    if [[ -n "$segments" ]]; then
        echo "$segments "
    fi
}
if [[ "$PROMPT" != *'$(_gs_assume_prompt)'* ]]; then
    PROMPT='$(_gs_assume_prompt)'"$PROMPT"
fi
"#
        .to_string(),
        "fish" => r#"
function _gs_assume_prompt
    set -l segments (gs-assume status --prompt 2>/dev/null)
    if test -n "$segments"
        echo -n "$segments "
    end
end
if not functions -q _original_fish_prompt
    functions -c fish_prompt _original_fish_prompt
    function fish_prompt
        _gs_assume_prompt
        _original_fish_prompt
    end
end
"#
        .to_string(),
        _ => format!("# Unsupported shell: {shell}\n"),
    }
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
}
