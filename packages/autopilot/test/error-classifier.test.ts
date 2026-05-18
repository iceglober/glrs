/**
 * Tests for the error classifier and retry-with-backoff helper.
 */

import { describe, it, expect } from "bun:test";
import {
  classifyError,
  retryWithBackoff,
} from "../src/lib/error-classifier.js";

describe("classifyError", () => {
  describe("transient", () => {
    it("classifies network timeouts as transient", () => {
      expect(classifyError("ETIMEDOUT")).toBe("transient");
      expect(classifyError("read ECONNRESET")).toBe("transient");
      expect(classifyError("getaddrinfo EAI_AGAIN xyz")).toBe("transient");
      expect(classifyError("socket hang up")).toBe("transient");
      expect(classifyError("fetch failed")).toBe("transient");
    });

    it("classifies rate-limit errors as transient", () => {
      expect(classifyError("429 Too Many Requests")).toBe("transient");
      expect(classifyError("rate limit exceeded")).toBe("transient");
      expect(classifyError("Throttling: try again later")).toBe("transient");
    });

    it("classifies 5xx server errors as transient", () => {
      expect(classifyError("500 Internal Server Error")).toBe("transient");
      expect(classifyError("502 Bad Gateway")).toBe("transient");
      expect(classifyError("503 Service Unavailable")).toBe("transient");
      expect(classifyError("504 Gateway Timeout")).toBe("transient");
    });

    it("matches case-insensitively", () => {
      expect(classifyError("Etimedout")).toBe("transient");
      expect(classifyError("RATE LIMIT")).toBe("transient");
    });
  });

  describe("credential-expired", () => {
    it("classifies STS / SSO expiry as credential-expired", () => {
      expect(classifyError("ExpiredToken: token has expired")).toBe(
        "credential-expired",
      );
      expect(classifyError("InvalidIdentityToken")).toBe("credential-expired");
      expect(classifyError("TokenRefreshRequired")).toBe("credential-expired");
    });

    it("classifies expired-credentials phrasing variants", () => {
      expect(classifyError("AWS credentials expired")).toBe(
        "credential-expired",
      );
      expect(classifyError("The credentials are expired")).toBe(
        "credential-expired",
      );
      expect(classifyError("session expired, please log in")).toBe(
        "credential-expired",
      );
      expect(classifyError("Your SSO session has expired")).toBe(
        "credential-expired",
      );
    });

    it("treats credential-expired as a separate category from transient", () => {
      // "expired" + "token" should NOT be misclassified as transient
      // even though "token" is not a transient pattern. We verify that
      // a credential message is returned as credential-expired.
      const result = classifyError("ExpiredTokenException: refresh required");
      expect(result).toBe("credential-expired");
    });
  });

  describe("permanent", () => {
    it("classifies validation / 4xx errors as permanent", () => {
      expect(classifyError("400 Bad Request")).toBe("permanent");
      expect(classifyError("404 model not found")).toBe("permanent");
      expect(classifyError("validation error")).toBe("permanent");
    });

    it("returns permanent for unknown / empty input", () => {
      expect(classifyError("")).toBe("permanent");
      expect(classifyError(null)).toBe("permanent");
      expect(classifyError(undefined)).toBe("permanent");
      expect(classifyError(42)).toBe("permanent");
      expect(classifyError({})).toBe("permanent");
    });

    it("never throws on unexpected input", () => {
      expect(() => classifyError(Symbol("x"))).not.toThrow();
      expect(() => classifyError([])).not.toThrow();
    });
  });
});

describe("retryWithBackoff", () => {
  it("returns the first successful result without retrying", async () => {
    let calls = 0;
    const result = await retryWithBackoff(
      async () => {
        calls++;
        return "ok";
      },
      { maxAttempts: 3, baseMs: 1, maxMs: 10 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  it("retries on thrown errors up to maxAttempts", async () => {
    let calls = 0;
    const result = await retryWithBackoff(
      async () => {
        calls++;
        if (calls < 3) throw new Error("fail");
        return "ok";
      },
      { maxAttempts: 3, baseMs: 1, maxMs: 10 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("rethrows the last error after exhausting attempts", async () => {
    let calls = 0;
    await expect(
      retryWithBackoff(
        async () => {
          calls++;
          throw new Error(`fail-${calls}`);
        },
        { maxAttempts: 3, baseMs: 1, maxMs: 10 },
      ),
    ).rejects.toThrow("fail-3");
    expect(calls).toBe(3);
  });

  it("invokes onRetry callback before each backoff sleep", async () => {
    const retries: Array<{ attempt: number; delayMs: number }> = [];
    let calls = 0;
    await retryWithBackoff(
      async () => {
        calls++;
        if (calls < 3) throw new Error("fail");
        return "ok";
      },
      {
        maxAttempts: 3,
        baseMs: 1,
        maxMs: 10,
        onRetry: (attempt, delayMs) => retries.push({ attempt, delayMs }),
      },
    );
    // 2 retries fire — between attempt 1→2 and attempt 2→3
    expect(retries).toHaveLength(2);
    expect(retries[0]).toEqual({ attempt: 1, delayMs: 1 });
    expect(retries[1]).toEqual({ attempt: 2, delayMs: 2 });
  });

  it("caps the backoff delay at maxMs", async () => {
    const retries: Array<{ delayMs: number }> = [];
    let calls = 0;
    await expect(
      retryWithBackoff(
        async () => {
          calls++;
          throw new Error("fail");
        },
        {
          maxAttempts: 5,
          baseMs: 100,
          maxMs: 250,
          onRetry: (_a, delayMs) => retries.push({ delayMs }),
        },
      ),
    ).rejects.toThrow();
    // Attempts 1→2: 100, 2→3: 200, 3→4: 250 (capped from 400), 4→5: 250
    expect(retries.map((r) => r.delayMs)).toEqual([100, 200, 250, 250]);
  });

  it("rejects when maxAttempts < 1", async () => {
    await expect(
      retryWithBackoff(async () => "ok", {
        maxAttempts: 0,
        baseMs: 1,
        maxMs: 10,
      }),
    ).rejects.toThrow("maxAttempts must be >= 1");
  });

  it("aborts gracefully when signal is fired during backoff", async () => {
    const ac = new AbortController();
    let calls = 0;
    const promise = retryWithBackoff(
      async () => {
        calls++;
        throw new Error("fail");
      },
      {
        maxAttempts: 5,
        baseMs: 50,
        maxMs: 50,
        signal: ac.signal,
      },
    );
    // After first failure, the loop will sleep ~50ms before retry 2.
    setTimeout(() => ac.abort(), 10);
    await expect(promise).rejects.toThrow();
    // Should have only called once (sleep aborted before retry)
    expect(calls).toBe(1);
  });
});
