/**
 * Error classifier + retry-with-backoff helpers.
 *
 * `classifyError(message)` performs a pure, case-insensitive substring
 * match against hardcoded patterns observed from AWS Bedrock + OpenAI +
 * Azure providers. Three categories:
 *
 *   - "transient"          — network blips, 5xx, throttling, generic
 *                             credential refreshes (will be retried).
 *   - "credential-expired" — explicit token expiry signals where SSO
 *                             refresh is required (no retry — must
 *                             surface to the user).
 *   - "permanent"          — 4xx (other than 429), validation errors,
 *                             unknown model. Retry will not help.
 *
 * `retryWithBackoff(fn, opts)` wraps any async function with capped
 * exponential backoff (1s → 2s → 4s → ... up to maxMs).
 */

export type ErrorClass = "transient" | "credential-expired" | "permanent";

/**
 * Substring patterns (case-insensitive) that mark a recoverable
 * transient failure. Includes generic credential-refresh hints —
 * those bypass classification as "credential-expired" only when the
 * message also contains an explicit expiry signal (see below).
 */
const TRANSIENT_PATTERNS: ReadonlyArray<string> = [
  // Network
  "etimedout",
  "econnreset",
  "eai_again",
  "socket hang up",
  "network",
  "fetch failed",
  // Rate limits
  "429",
  "too many requests",
  "rate limit",
  "throttling",
  "throttled",
  // Server-side
  "500",
  "502",
  "503",
  "504",
  "internal server error",
  "service unavailable",
  "bad gateway",
  "gateway timeout",
];

/**
 * Substring patterns that explicitly mark expired credentials. These
 * take precedence over generic "transient" classification — the loop
 * cannot recover by retrying, the user must run `gs-assume`.
 */
const CREDENTIAL_EXPIRED_PATTERNS: ReadonlyArray<RegExp> = [
  /expiredtoken/i,
  /invalididentitytoken/i,
  /tokenrefreshrequired/i,
  /expired.*token/i,
  /token.*expired/i,
  /credentials?.*expired/i,
  /expired.*credentials?/i,
  /sso.*expired/i,
  /session.*expired/i,
];

/**
 * Substring patterns that mark a permanent failure (no retry).
 * Empty array — permanent is the default; we explicitly enumerate
 * transient + credential-expired and fall through to permanent.
 */

/**
 * Classify an error message into one of three categories.
 *
 * Pure function. Never throws. Returns "permanent" for any unexpected
 * input (null, undefined, non-string).
 */
export function classifyError(message: unknown): ErrorClass {
  if (typeof message !== "string" || message.length === 0) {
    return "permanent";
  }
  const lower = message.toLowerCase();

  // Credential expiry takes precedence — these are a special form of
  // auth failure that retry cannot fix.
  for (const re of CREDENTIAL_EXPIRED_PATTERNS) {
    if (re.test(message)) {
      return "credential-expired";
    }
  }

  // Substring match against transient patterns.
  for (const pattern of TRANSIENT_PATTERNS) {
    if (lower.includes(pattern)) {
      return "transient";
    }
  }

  return "permanent";
}

/**
 * Sleep for `ms` milliseconds. Cancellable via AbortSignal.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const handle = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(handle);
      reject(new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface RetryOptions {
  /** Maximum number of attempts (initial + retries). Must be >= 1. */
  maxAttempts: number;
  /** Base backoff in ms (first retry waits this long). */
  baseMs: number;
  /** Cap on backoff in ms. */
  maxMs: number;
  /**
   * Optional abort signal. When aborted, the next backoff sleep is
   * cancelled and the loop exits with the most-recent error.
   */
  signal?: AbortSignal;
  /**
   * Optional callback fired before each retry. Useful for logging.
   * Receives the attempt number that just failed (1-indexed) and the
   * computed delay before the next attempt.
   */
  onRetry?: (attempt: number, delayMs: number, err: unknown) => void;
}

/**
 * Run `fn` with exponential backoff. Re-runs on any thrown error up to
 * `maxAttempts` times. Backoff schedule: baseMs * 2^(attempt-1), capped
 * at maxMs. Returns the first successful result; rethrows the last
 * error if all attempts fail.
 *
 * Note: this helper retries on ANY thrown error. Callers that need
 * conditional retry (only on transient errors) should call
 * `classifyError` first and skip retry for permanent failures.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const { maxAttempts, baseMs, maxMs, signal, onRetry } = opts;
  if (maxAttempts < 1) {
    throw new Error("retryWithBackoff: maxAttempts must be >= 1");
  }

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts) break;
      // Compute backoff: baseMs * 2^(attempt-1), capped at maxMs.
      const delay = Math.min(baseMs * Math.pow(2, attempt - 1), maxMs);
      onRetry?.(attempt, delay, err);
      try {
        await sleep(delay, signal);
      } catch {
        // Sleep aborted — exit loop, rethrow last error
        break;
      }
    }
  }
  throw lastErr;
}
