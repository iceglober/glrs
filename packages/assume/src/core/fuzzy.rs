use crate::plugin::Context;

/// Result of a fuzzy match with score
#[derive(Debug, Clone)]
pub struct MatchResult {
    pub context: Context,
    pub score: u32,
}

/// Parse a pattern that may have a provider prefix like "aws:dev"
pub fn parse_pattern(pattern: &str) -> (Option<&str>, &str) {
    if let Some(idx) = pattern.find(':') {
        let prefix = &pattern[..idx];
        let rest = &pattern[idx + 1..];
        // Only treat as provider prefix if prefix is lowercase alpha
        if !prefix.is_empty() && prefix.chars().all(|c| c.is_ascii_lowercase()) {
            return (Some(prefix), rest);
        }
    }
    (None, pattern)
}

/// Match a pattern against a list of contexts.
/// Returns matches sorted by score (best first).
///
/// Matching priority:
/// 1. Exact match on id or alias (score: 1000)
/// 2. Prefix match on id, display_name, or alias (score: 500 + match length bonus)
/// 3. Substring match (score: 200 + position bonus)
/// 4. Fuzzy match via nucleo on searchable_fields (score: nucleo score)
///
/// If pattern has a provider prefix (e.g., "aws:dev"), only contexts
/// from that provider are considered.
pub fn match_contexts(pattern: &str, contexts: &[Context]) -> Vec<MatchResult> {
    let (provider_filter, query) = parse_pattern(pattern);

    if query.is_empty() {
        // No query — return all contexts (filtered by provider if specified)
        return contexts
            .iter()
            .filter(|c| provider_filter.map_or(true, |p| c.provider_id == p))
            .map(|c| MatchResult {
                context: c.clone(),
                score: 0,
            })
            .collect();
    }

    let query_lower = query.to_lowercase();
    let mut results = Vec::new();

    for ctx in contexts {
        if let Some(pf) = provider_filter {
            if ctx.provider_id != pf {
                continue;
            }
        }

        let best_score = score_context(ctx, &query_lower);
        if best_score > 0 {
            results.push(MatchResult {
                context: ctx.clone(),
                score: best_score,
            });
        }
    }

    results.sort_by(|a, b| b.score.cmp(&a.score));
    results
}

/// Score a single context against a lowercased query
fn score_context(ctx: &Context, query: &str) -> u32 {
    let mut best = 0u32;

    // Collect all searchable strings
    let mut candidates: Vec<&str> = vec![&ctx.id, &ctx.display_name];
    for field in &ctx.searchable_fields {
        candidates.push(field);
    }
    for tag in &ctx.tags {
        candidates.push(tag);
    }
    // Include metadata values (alias, account_id, role_name, etc.)
    for val in ctx.metadata.values() {
        candidates.push(val);
    }

    for candidate in &candidates {
        let candidate_lower = candidate.to_lowercase();

        // Exact match
        if candidate_lower == query {
            return 1000;
        }

        // Prefix match
        if candidate_lower.starts_with(query) {
            let score = 500 + (query.len() as u32 * 10);
            best = best.max(score);
            continue;
        }

        // Substring match
        if let Some(pos) = candidate_lower.find(query) {
            // Bonus for earlier position
            let pos_bonus = if pos < 10 { (10 - pos) as u32 * 5 } else { 0 };
            let score = 200 + pos_bonus + (query.len() as u32 * 3);
            best = best.max(score);
            continue;
        }

        // Fuzzy match — character subsequence
        let fuzzy_score = fuzzy_score(&candidate_lower, query);
        if fuzzy_score > 0 {
            best = best.max(fuzzy_score);
        }
    }

    best
}

/// Simple fuzzy matching: checks if query chars appear in order in candidate.
/// Returns a score based on how tightly packed the matches are.
fn fuzzy_score(candidate: &str, query: &str) -> u32 {
    let candidate_chars: Vec<char> = candidate.chars().collect();
    let query_chars: Vec<char> = query.chars().collect();

    if query_chars.is_empty() {
        return 0;
    }

    let mut qi = 0;
    let mut first_match = None;
    let mut last_match = 0;
    let mut consecutive_bonus = 0u32;
    let mut prev_match_idx: Option<usize> = None;

    for (ci, &cc) in candidate_chars.iter().enumerate() {
        if qi < query_chars.len() && cc == query_chars[qi] {
            if first_match.is_none() {
                first_match = Some(ci);
            }
            last_match = ci;

            // Bonus for consecutive matches
            if let Some(prev) = prev_match_idx {
                if ci == prev + 1 {
                    consecutive_bonus += 15;
                }
            }
            prev_match_idx = Some(ci);
            qi += 1;
        }
    }

    if qi < query_chars.len() {
        return 0; // Not all query chars found
    }

    let first = first_match.unwrap_or(0);
    let span = last_match - first + 1;
    let tightness = if span > 0 {
        (query_chars.len() as u32 * 100) / (span as u32)
    } else {
        100
    };

    // Base score + tightness + consecutive bonus + early match bonus
    let early_bonus = if first < 5 { (5 - first) as u32 * 5 } else { 0 };
    let base = 50 + tightness + consecutive_bonus + early_bonus;

    base.min(199) // Cap below substring match
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn make_ctx(provider: &str, id: &str, display: &str, tags: Vec<&str>) -> Context {
        Context {
            provider_id: provider.into(),
            id: id.into(),
            display_name: display.into(),
            searchable_fields: vec![id.into(), display.into()],
            tags: tags.into_iter().map(String::from).collect(),
            metadata: HashMap::new(),
            region: "us-east-1".into(),
        }
    }

    #[test]
    fn test_parse_pattern_no_prefix() {
        assert_eq!(parse_pattern("dev"), (None, "dev"));
        assert_eq!(parse_pattern("dev/deploy"), (None, "dev/deploy"));
    }

    #[test]
    fn test_parse_pattern_with_prefix() {
        assert_eq!(parse_pattern("aws:dev"), (Some("aws"), "dev"));
        assert_eq!(parse_pattern("gcp:my-project"), (Some("gcp"), "my-project"));
    }

    #[test]
    fn test_exact_match_highest_score() {
        let contexts = vec![
            make_ctx("aws", "dev", "Development Account", vec!["development"]),
            make_ctx("aws", "dev-staging", "Dev Staging", vec![]),
        ];
        let results = match_contexts("dev", &contexts);
        assert_eq!(results[0].context.id, "dev");
        assert_eq!(results[0].score, 1000);
    }

    #[test]
    fn test_prefix_beats_substring() {
        let contexts = vec![
            make_ctx("aws", "production", "Production", vec![]),
            make_ctx("aws", "dev-prod", "Dev Prod", vec![]),
        ];
        let results = match_contexts("prod", &contexts);
        assert_eq!(results[0].context.id, "production");
        assert!(results[0].score > results[1].score);
    }

    #[test]
    fn test_provider_prefix_filter() {
        let contexts = vec![
            make_ctx("aws", "dev", "AWS Dev", vec![]),
            make_ctx("gcp", "dev", "GCP Dev", vec![]),
        ];
        let results = match_contexts("aws:dev", &contexts);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].context.provider_id, "aws");
    }

    #[test]
    fn test_fuzzy_match() {
        let contexts = vec![
            make_ctx("aws", "development-account", "Development Account", vec![]),
        ];
        let results = match_contexts("dvlp", &contexts);
        assert!(!results.is_empty());
        assert!(results[0].score > 0);
    }

    #[test]
    fn test_no_match() {
        let contexts = vec![
            make_ctx("aws", "dev", "Development", vec![]),
        ];
        let results = match_contexts("zzzzz", &contexts);
        assert!(results.is_empty());
    }

    #[test]
    fn test_empty_query_returns_all() {
        let contexts = vec![
            make_ctx("aws", "dev", "Dev", vec![]),
            make_ctx("gcp", "prod", "Prod", vec![]),
        ];
        let results = match_contexts("", &contexts);
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn test_empty_query_with_provider_filter() {
        let contexts = vec![
            make_ctx("aws", "dev", "Dev", vec![]),
            make_ctx("gcp", "prod", "Prod", vec![]),
        ];
        let results = match_contexts("aws:", &contexts);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].context.provider_id, "aws");
    }
}
