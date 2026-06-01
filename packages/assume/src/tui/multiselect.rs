//! A small, generic checkbox multi-select over a fixed list of labeled items.
//!
//! Unlike `picker::run_multi_select` (which is coupled to `Context` and fuzzy
//! search over a large list), this is for short, static choice lists — e.g.
//! "which agent tools should `gsa init` configure?". Items that are not
//! available can be shown disabled (rendered, but not toggleable / not
//! pre-selected).

use crossterm::event::{self, Event, KeyCode, KeyEventKind};
use crossterm::terminal::{self, EnterAlternateScreen, LeaveAlternateScreen};
use crossterm::ExecutableCommand;
use ratatui::prelude::*;
use ratatui::widgets::*;
use std::collections::HashSet;
use std::io;

/// One selectable row.
pub struct Item {
    pub id: String,
    pub label: String,
    /// Secondary text (e.g. config path or "(not detected)").
    pub detail: String,
    /// Disabled rows can't be toggled and aren't pre-selected.
    pub enabled: bool,
    /// Whether the row starts checked (ignored when `enabled` is false).
    pub preselected: bool,
}

pub enum SelectResult {
    /// Set of selected item ids (may be empty).
    Confirmed(HashSet<String>),
    Cancelled,
}

/// Run the multi-select. `title` is shown in the border.
pub fn run(title: &str, items: &[Item]) -> io::Result<SelectResult> {
    terminal::enable_raw_mode()?;
    let mut stdout = io::stdout();
    stdout.execute(EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let result = run_loop(&mut terminal, title, items);

    terminal::disable_raw_mode()?;
    terminal.backend_mut().execute(LeaveAlternateScreen)?;
    result
}

fn run_loop(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
    title: &str,
    items: &[Item],
) -> io::Result<SelectResult> {
    let mut selected: HashSet<String> = items
        .iter()
        .filter(|i| i.enabled && i.preselected)
        .map(|i| i.id.clone())
        .collect();

    // Cursor starts on the first enabled row, if any.
    let mut cursor = items.iter().position(|i| i.enabled).unwrap_or(0);

    loop {
        terminal.draw(|frame| render(frame, title, items, cursor, &selected))?;

        if let Event::Key(key) = event::read()? {
            if key.kind != KeyEventKind::Press {
                continue;
            }
            match key.code {
                KeyCode::Esc => return Ok(SelectResult::Cancelled),
                KeyCode::Enter => return Ok(SelectResult::Confirmed(selected)),
                KeyCode::Char(' ') => {
                    if let Some(item) = items.get(cursor) {
                        if item.enabled {
                            if selected.contains(&item.id) {
                                selected.remove(&item.id);
                            } else {
                                selected.insert(item.id.clone());
                            }
                        }
                    }
                }
                KeyCode::Up => {
                    cursor = cursor.saturating_sub(1);
                }
                KeyCode::Down if cursor + 1 < items.len() => {
                    cursor += 1;
                }
                _ => {}
            }
        }
    }
}

fn render(
    frame: &mut Frame,
    title: &str,
    items: &[Item],
    cursor: usize,
    selected: &HashSet<String>,
) {
    let area = frame.area();

    let block = Block::default()
        .title(format!(" {title} "))
        .title_alignment(Alignment::Center)
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded);
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(1), Constraint::Length(1)])
        .split(inner);

    let rows: Vec<ListItem> = items
        .iter()
        .enumerate()
        .map(|(idx, item)| {
            let checked = selected.contains(&item.id);
            let mark = if !item.enabled {
                "  - "
            } else if checked {
                " [x] "
            } else {
                " [ ] "
            };
            let pointer = if idx == cursor { ">" } else { " " };
            let style = if !item.enabled {
                Style::default().fg(Color::DarkGray)
            } else if idx == cursor {
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default()
            };
            let line = format!("{pointer}{mark}{}  {}", item.label, item.detail);
            ListItem::new(Line::from(Span::styled(line, style)))
        })
        .collect();

    frame.render_widget(List::new(rows), chunks[0]);
    frame.render_widget(
        Paragraph::new(Span::styled(
            "↑/↓ move · space toggle · enter confirm · esc cancel",
            Style::default().fg(Color::DarkGray),
        )),
        chunks[1],
    );
}
