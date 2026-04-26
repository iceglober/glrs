use crate::core::fuzzy;
use crate::plugin::Context;
use crossterm::event::{self, Event, KeyCode, KeyEventKind};
use crossterm::terminal::{self, EnterAlternateScreen, LeaveAlternateScreen};
use crossterm::ExecutableCommand;
use ratatui::prelude::*;
use ratatui::widgets::*;
use std::collections::HashSet;
use std::io;

/// Result of the picker interaction
pub enum PickerResult {
    Selected(Context),
    Cancelled,
}

/// Run the interactive context picker. Returns the selected context or None if cancelled.
pub fn run(contexts: &[Context], active_context_id: Option<&str>) -> io::Result<PickerResult> {
    // Setup terminal
    terminal::enable_raw_mode()?;
    let mut stdout = io::stdout();
    stdout.execute(EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let result = run_picker_loop(&mut terminal, contexts, active_context_id);

    // Restore terminal
    terminal::disable_raw_mode()?;
    terminal.backend_mut().execute(LeaveAlternateScreen)?;

    result
}

fn run_picker_loop(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
    all_contexts: &[Context],
    active_context_id: Option<&str>,
) -> io::Result<PickerResult> {
    let mut query = String::new();
    let mut selected_idx: usize = 0;
    let mut filtered: Vec<Context>;

    loop {
        // Filter contexts based on query
        if query.is_empty() {
            filtered = all_contexts.to_vec();
        } else {
            filtered = fuzzy::match_contexts(&query, all_contexts)
                .into_iter()
                .map(|m| m.context)
                .collect();
        }

        if selected_idx >= filtered.len() && !filtered.is_empty() {
            selected_idx = filtered.len() - 1;
        }

        terminal.draw(|frame| {
            render_picker(frame, &query, &filtered, selected_idx, active_context_id);
        })?;

        if let Event::Key(key) = event::read()? {
            if key.kind != KeyEventKind::Press {
                continue;
            }
            match key.code {
                KeyCode::Esc => return Ok(PickerResult::Cancelled),
                KeyCode::Enter => {
                    if let Some(ctx) = filtered.get(selected_idx) {
                        return Ok(PickerResult::Selected(ctx.clone()));
                    }
                }
                KeyCode::Up => {
                    selected_idx = selected_idx.saturating_sub(1);
                }
                KeyCode::Down => {
                    if selected_idx + 1 < filtered.len() {
                        selected_idx += 1;
                    }
                }
                KeyCode::Backspace => {
                    query.pop();
                    selected_idx = 0;
                }
                KeyCode::Char(c) => {
                    query.push(c);
                    selected_idx = 0;
                }
                _ => {}
            }
        }
    }
}

fn render_picker(
    frame: &mut Frame,
    query: &str,
    contexts: &[Context],
    selected_idx: usize,
    active_context_id: Option<&str>,
) {
    let area = frame.area();

    // Title block
    let block = Block::default()
        .title(" gs-assume ")
        .title_alignment(Alignment::Center)
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded);

    let inner = block.inner(area);
    frame.render_widget(block, area);

    // Layout: search bar at top, list below, help at bottom
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(2), // search
            Constraint::Min(3),    // list
            Constraint::Length(1), // help
        ])
        .split(inner);

    // Search bar
    let search_text = format!(" Search: {}_", query);
    let search = Paragraph::new(search_text).style(Style::default().fg(Color::White));
    frame.render_widget(search, chunks[0]);

    // Group contexts by provider
    let mut lines: Vec<Line> = Vec::new();
    let mut line_to_idx: Vec<Option<usize>> = Vec::new(); // maps display line to filtered index
    let mut current_provider = String::new();
    let mut display_selected_line: Option<usize> = None;

    for (idx, ctx) in contexts.iter().enumerate() {
        // Provider header
        if ctx.provider_id != current_provider {
            if !current_provider.is_empty() {
                lines.push(Line::from(""));
                line_to_idx.push(None);
            }
            current_provider = ctx.provider_id.clone();
            let header = Line::from(vec![Span::styled(
                format!(" {}", current_provider.to_uppercase()),
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            )]);
            lines.push(header);
            line_to_idx.push(None);
        }

        // Context line
        let is_active = active_context_id.is_some_and(|id| id == ctx.id);
        let is_dangerous = ctx
            .tags
            .iter()
            .any(|t| t == "dangerous" || t == "production");
        let is_selected = idx == selected_idx;

        let marker = if is_active { "\u{25cf}" } else { " " };
        let danger = if is_dangerous { " \u{26a0}" } else { "" };

        let alias = ctx.metadata.get("alias").map(String::as_str).unwrap_or("");
        let display = if alias.is_empty() {
            ctx.display_name.clone()
        } else {
            format!("{} ({})", ctx.display_name, alias)
        };

        let region_str = if ctx.region.is_empty() {
            String::new()
        } else {
            format!("  {}", ctx.region)
        };

        let style = if is_selected {
            Style::default().bg(Color::DarkGray).fg(Color::White)
        } else if is_dangerous {
            Style::default().fg(Color::Red)
        } else if is_active {
            Style::default().fg(Color::Green)
        } else {
            Style::default()
        };

        let line = Line::from(vec![
            Span::styled(
                format!("  {marker} "),
                if is_active {
                    Style::default().fg(Color::Green)
                } else {
                    Style::default().fg(Color::DarkGray)
                },
            ),
            Span::styled(display, style),
            Span::styled(danger, Style::default().fg(Color::Yellow)),
            Span::styled(region_str, Style::default().fg(Color::DarkGray)),
        ]);

        if is_selected {
            display_selected_line = Some(lines.len());
        }

        lines.push(line);
        line_to_idx.push(Some(idx));
    }

    if contexts.is_empty() {
        lines.push(Line::from(Span::styled(
            "  No matching contexts",
            Style::default().fg(Color::DarkGray),
        )));
    }

    let list = Paragraph::new(lines).scroll((
        // Scroll to keep selected item visible
        display_selected_line
            .map(|l| l.saturating_sub(chunks[1].height as usize / 2) as u16)
            .unwrap_or(0),
        0,
    ));
    frame.render_widget(list, chunks[1]);

    // Help line
    let help = Paragraph::new(Line::from(vec![
        Span::styled(" \u{25cf} ", Style::default().fg(Color::Green)),
        Span::raw("= active  "),
        Span::styled("\u{26a0} ", Style::default().fg(Color::Yellow)),
        Span::raw("= dangerous  "),
        Span::styled("\u{2191}\u{2193}", Style::default().fg(Color::Cyan)),
        Span::raw(" navigate  "),
        Span::styled("\u{23ce}", Style::default().fg(Color::Cyan)),
        Span::raw(" select  "),
        Span::styled("Esc", Style::default().fg(Color::Cyan)),
        Span::raw(" cancel"),
    ]))
    .style(Style::default().fg(Color::DarkGray));
    frame.render_widget(help, chunks[2]);
}

// ---------------------------------------------------------------------------
// Multi-select picker
// ---------------------------------------------------------------------------

/// Result of the multi-select picker interaction
pub enum MultiSelectResult {
    Saved(HashSet<String>),
    Cancelled,
}

/// Run an interactive multi-select picker.
/// Shows all contexts with checkboxes; `initially_selected` seeds the checked set.
/// Returns the final set on Enter, or `Cancelled` on Esc.
pub fn run_multi_select(
    contexts: &[Context],
    initially_selected: &HashSet<String>,
) -> io::Result<MultiSelectResult> {
    terminal::enable_raw_mode()?;
    let mut stdout = io::stdout();
    stdout.execute(EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let result = run_multi_select_loop(&mut terminal, contexts, initially_selected);

    terminal::disable_raw_mode()?;
    terminal.backend_mut().execute(LeaveAlternateScreen)?;

    result
}

fn run_multi_select_loop(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
    all_contexts: &[Context],
    initially_selected: &HashSet<String>,
) -> io::Result<MultiSelectResult> {
    let mut query = String::new();
    let mut selected_idx: usize = 0;
    let mut selected_ids: HashSet<String> = initially_selected.clone();
    let mut filtered: Vec<Context>;

    loop {
        // Filter contexts based on query
        if query.is_empty() {
            filtered = all_contexts.to_vec();
        } else {
            filtered = fuzzy::match_contexts(&query, all_contexts)
                .into_iter()
                .map(|m| m.context)
                .collect();
        }

        if selected_idx >= filtered.len() && !filtered.is_empty() {
            selected_idx = filtered.len() - 1;
        }

        terminal.draw(|frame| {
            render_multi_select(frame, &query, &filtered, selected_idx, &selected_ids);
        })?;

        if let Event::Key(key) = event::read()? {
            if key.kind != KeyEventKind::Press {
                continue;
            }
            match key.code {
                KeyCode::Esc => return Ok(MultiSelectResult::Cancelled),
                KeyCode::Enter => {
                    return Ok(MultiSelectResult::Saved(selected_ids));
                }
                KeyCode::Char(' ') => {
                    if let Some(ctx) = filtered.get(selected_idx) {
                        if selected_ids.contains(&ctx.id) {
                            selected_ids.remove(&ctx.id);
                        } else {
                            selected_ids.insert(ctx.id.clone());
                        }
                    }
                }
                KeyCode::Up => {
                    selected_idx = selected_idx.saturating_sub(1);
                }
                KeyCode::Down => {
                    if selected_idx + 1 < filtered.len() {
                        selected_idx += 1;
                    }
                }
                KeyCode::Backspace => {
                    query.pop();
                    selected_idx = 0;
                }
                KeyCode::Char(c) => {
                    query.push(c);
                    selected_idx = 0;
                }
                _ => {}
            }
        }
    }
}

fn render_multi_select(
    frame: &mut Frame,
    query: &str,
    contexts: &[Context],
    selected_idx: usize,
    selected_ids: &HashSet<String>,
) {
    let area = frame.area();

    // Title block
    let block = Block::default()
        .title(" gsa agent allow ")
        .title_alignment(Alignment::Center)
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded);

    let inner = block.inner(area);
    frame.render_widget(block, area);

    // Layout: search bar at top, list below, help at bottom
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(2), // search
            Constraint::Min(3),    // list
            Constraint::Length(1), // help
        ])
        .split(inner);

    // Search bar
    let search_text = format!(" Search: {}_", query);
    let search = Paragraph::new(search_text).style(Style::default().fg(Color::White));
    frame.render_widget(search, chunks[0]);

    // Group contexts by provider
    let mut lines: Vec<Line> = Vec::new();
    let mut current_provider = String::new();
    let mut display_selected_line: Option<usize> = None;

    for (idx, ctx) in contexts.iter().enumerate() {
        // Provider header
        if ctx.provider_id != current_provider {
            if !current_provider.is_empty() {
                lines.push(Line::from(""));
            }
            current_provider = ctx.provider_id.clone();
            let header = Line::from(vec![Span::styled(
                format!(" {}", current_provider.to_uppercase()),
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            )]);
            lines.push(header);
        }

        // Context line
        let is_checked = selected_ids.contains(&ctx.id);
        let is_dangerous = ctx
            .tags
            .iter()
            .any(|t| t == "dangerous" || t == "production");
        let is_focused = idx == selected_idx;

        let checkbox = if is_checked { "[x]" } else { "[ ]" };
        let danger = if is_dangerous { " \u{26a0}" } else { "" };

        let alias = ctx.metadata.get("alias").map(String::as_str).unwrap_or("");
        let display = if alias.is_empty() {
            ctx.display_name.clone()
        } else {
            format!("{} ({})", ctx.display_name, alias)
        };

        let region_str = if ctx.region.is_empty() {
            String::new()
        } else {
            format!("  {}", ctx.region)
        };

        let style = if is_focused {
            Style::default().bg(Color::DarkGray).fg(Color::White)
        } else if is_dangerous {
            Style::default().fg(Color::Red)
        } else {
            Style::default()
        };

        let checkbox_style = if is_checked {
            Style::default().fg(Color::Green)
        } else {
            Style::default().fg(Color::DarkGray)
        };

        let line = Line::from(vec![
            Span::styled(format!("  {} ", checkbox), checkbox_style),
            Span::styled(display, style),
            Span::styled(danger, Style::default().fg(Color::Yellow)),
            Span::styled(region_str, Style::default().fg(Color::DarkGray)),
        ]);

        if is_focused {
            display_selected_line = Some(lines.len());
        }

        lines.push(line);
    }

    if contexts.is_empty() {
        lines.push(Line::from(Span::styled(
            "  No matching contexts",
            Style::default().fg(Color::DarkGray),
        )));
    }

    let list = Paragraph::new(lines).scroll((
        display_selected_line
            .map(|l| l.saturating_sub(chunks[1].height as usize / 2) as u16)
            .unwrap_or(0),
        0,
    ));
    frame.render_widget(list, chunks[1]);

    // Help line
    let help = Paragraph::new(Line::from(vec![
        Span::styled("Space", Style::default().fg(Color::Cyan)),
        Span::raw(": toggle  "),
        Span::styled("Enter", Style::default().fg(Color::Cyan)),
        Span::raw(": save  "),
        Span::styled("Esc", Style::default().fg(Color::Cyan)),
        Span::raw(": cancel  "),
        Span::styled("\u{2191}\u{2193}", Style::default().fg(Color::Cyan)),
        Span::raw(": navigate"),
    ]))
    .style(Style::default().fg(Color::DarkGray));
    frame.render_widget(help, chunks[2]);
}
