/**
 * Bun.serve-based proxy server.
 *
 * v0: single ingress (Anthropic Messages /v1/messages), single backend (Bedrock
 * Converse), no compression. Loopback-only bind.
 *
 * Routes:
 *   GET  /health           → liveness
 *   POST /v1/messages      → Anthropic ingress → IR → Bedrock Converse → SSE
 *   *                      → 404
 */

import {
  BadRequest,
  decodeAnthropicRequest,
  encodeAnthropicSse,
} from "../providers/anthropic/translate.js";
import type { Provider } from "../providers/types.js";
import { getLogger } from "../lib/logger.js";

export interface ProxyOptions {
  port: number;
  host?: string; // defaults to 127.0.0.1
  provider: Provider;
  /**
   * Per-session stub bearer the client must present. If undefined, no inbound
   * auth check is performed (useful for local debugging).
   */
  stubBearer?: string;
}

export interface ProxyHandle {
  url: string;
  port: number;
  stop(): Promise<void>;
}

export function createProxy(opts: ProxyOptions): {
  fetch: (req: Request) => Promise<Response>;
} {
  const log = getLogger();
  const host = opts.host ?? "127.0.0.1";

  const fetch = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    log.debug({ method: req.method, path: url.pathname }, "proxy request");

    if (req.method === "GET" && url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/messages") {
      const authErr = checkAuth(req, opts.stubBearer);
      if (authErr) return authErr;
      return handleAnthropicMessages(req, opts.provider);
    }

    return new Response(
      JSON.stringify({ error: { type: "not_found", message: `${req.method} ${url.pathname}` } }),
      { status: 404, headers: { "content-type": "application/json" } },
    );
  };

  // Mark host as used so it isn't flagged in lint passes that don't see the
  // start helper below. The actual bind happens in start().
  void host;

  return { fetch };
}

/**
 * Start a Bun.serve listener for the given proxy. Returns a handle with the
 * resolved URL and a stop() that drains in-flight requests up to 3s.
 */
export function startProxy(opts: ProxyOptions): ProxyHandle {
  const { fetch } = createProxy(opts);
  const host = opts.host ?? "127.0.0.1";
  // @ts-ignore - Bun global
  const server = Bun.serve({
    port: opts.port,
    hostname: host,
    fetch,
    error(err: Error) {
      getLogger().error({ err: err.message }, "proxy fetch threw");
      return new Response(
        JSON.stringify({ error: { type: "internal_error", message: err.message } }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    },
  });
  const port = (server as { port: number }).port;
  return {
    url: `http://${host}:${port}`,
    port,
    async stop() {
      // Bun's stop(true) waits for in-flight; pass false to drain quickly.
      // We give 3s of grace for streaming responses to flush.
      (server as { stop: (graceful: boolean) => void }).stop(true);
      await new Promise((r) => setTimeout(r, 50)); // small settle window
    },
  };
}

function checkAuth(req: Request, expected: string | undefined): Response | null {
  if (!expected) return null;
  const got = req.headers.get("authorization") ?? req.headers.get("x-api-key");
  const value = got?.startsWith("Bearer ") ? got.slice("Bearer ".length) : got;
  if (value === expected) return null;
  return new Response(
    JSON.stringify({
      error: { type: "authentication_error", message: "invalid api key" },
    }),
    { status: 401, headers: { "content-type": "application/json" } },
  );
}

async function handleAnthropicMessages(
  req: Request,
  provider: Provider,
): Promise<Response> {
  const log = getLogger();
  let body: unknown;
  try {
    body = await req.json();
  } catch (err) {
    return jsonError(400, "invalid_request_error", `body is not valid JSON: ${(err as Error).message}`);
  }

  let decoded;
  try {
    decoded = decodeAnthropicRequest(body);
  } catch (err) {
    if (err instanceof BadRequest) {
      return jsonError(400, "invalid_request_error", err.message);
    }
    throw err;
  }

  log.info(
    {
      model: decoded.model,
      stream: decoded.stream,
      messages: decoded.messages.length,
      tools: decoded.tools?.length ?? 0,
    },
    "anthropic ingress",
  );

  if (!decoded.stream) {
    // v0 supports streaming only — Claude Code, Cursor, OpenCode all stream.
    // If we later need non-streaming, we'll accumulate the stream into a
    // single response. For now, surface a clear error.
    return jsonError(
      400,
      "invalid_request_error",
      "cmprss v0 supports `stream: true` only. Send a streaming request, or open an issue if you need non-streaming.",
    );
  }

  const sigCtl = new AbortController();
  req.signal.addEventListener("abort", () => sigCtl.abort(), { once: true });

  let stream: AsyncIterable<import("../providers/types.js").StreamEvent>;
  try {
    stream = provider.stream(decoded, sigCtl.signal);
  } catch (err) {
    log.error({ err: (err as Error).message }, "provider.stream threw");
    return jsonError(502, "api_error", `backend error: ${(err as Error).message}`);
  }

  const sseBody = encodeAnthropicSse(stream);
  return new Response(sseBody, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

function jsonError(status: number, type: string, message: string): Response {
  return new Response(
    JSON.stringify({ type: "error", error: { type, message } }),
    { status, headers: { "content-type": "application/json" } },
  );
}
