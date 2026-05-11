use chrono::{DateTime, Utc};

/// Abstraction over wall-clock time.
/// The production implementation calls `chrono::Utc::now()`.
/// Tests inject a `MockClock` whose value can be advanced deterministically.
pub trait Clock: Send + Sync {
    fn now(&self) -> DateTime<Utc>;
}

/// Production implementation — zero-cost wrapper around `chrono::Utc::now()`.
pub struct SystemClock;

impl Clock for SystemClock {
    #[inline]
    fn now(&self) -> DateTime<Utc> {
        Utc::now()
    }
}

/// Test implementation — wraps an `Arc<std::sync::Mutex<DateTime<Utc>>>` so tests
/// can advance time freely without real sleeps.
///
/// Available in integration tests (not just unit tests) because integration tests
/// are compiled as separate crates that import from the library.
pub struct MockClock {
    current: std::sync::Arc<std::sync::Mutex<DateTime<Utc>>>,
}

impl MockClock {
    pub fn new(initial: DateTime<Utc>) -> Self {
        Self {
            current: std::sync::Arc::new(std::sync::Mutex::new(initial)),
        }
    }

    /// Advance the clock by `duration`.
    pub fn advance(&self, duration: chrono::Duration) {
        let mut t = self.current.lock().unwrap();
        *t += duration;
    }

    /// Set the clock to an absolute time.
    pub fn set(&self, t: DateTime<Utc>) {
        *self.current.lock().unwrap() = t;
    }
}

impl Clock for MockClock {
    fn now(&self) -> DateTime<Utc> {
        *self.current.lock().unwrap()
    }
}
