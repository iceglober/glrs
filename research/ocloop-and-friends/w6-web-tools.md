# W6: Better Web-Research Tooling for Research Agents

**Status:** COMPLETE  
**Last updated:** 2026-05-11  
**Scope:** Survey MCP servers, OpenCode plugin capabilities, and alternative approaches for improving web research beyond the built-in `webfetch` tool.

---

## 1. Current State: What `webfetch` Does and Doesn't Do

OpenCode's built-in `webfetch` tool:
- Fetches a single URL and returns markdown/text/html
- Upgrades HTTP to HTTPS automatically
- Has a 120s timeout

It does **NOT**:
- Search the web for queries (requires knowing the URL already)
- Execute JavaScript (SPAs/React pages return empty shells)
- Handle pagination across result sets
- Extract structured data (JSON schema extraction)
- Deduplicate sources across multiple fetches
- Provide citations with timestamps
- Cache results across a session
- Crawl/map a site's link structure

---

## 2. OpenCode's Tool Registration Surface (Category C)

**Checked:** [OpenCode Plugins docs](https://opencode.ai/docs/plugins/) and [Custom Tools docs](https://opencode.ai/docs/custom-tools/)

OpenCode provides **two** mechanisms for adding tools:

### 2a. Plugin-registered tools (via `@opencode-ai/plugin`)

A plugin can export a `tool` object that becomes available to all agents:

```ts
import { tool } from "@opencode-ai/plugin"

export const CustomToolsPlugin: Plugin = async (ctx) => {
  return {
    tool: {
      websearch: tool({
        description: "Search the web",
        args: { query: tool.schema.string() },
        async execute(args, context) {
          // call search API here
          return results
        },
      }),
    },
  }
}
```

Key facts:
- Plugin tools **override** built-in tools of the same name
- They receive `context` with `directory`, `worktree`, `sessionID`, `agent`
- They can use `Bun.$` for shell commands or any npm package
- Plugin packages are auto-installed from npm at startup into `~/.cache/opencode/node_modules/`

**Implication for us:** Our harness plugin (`@glrs-dev/harness-plugin-opencode`) could register a `websearch` custom tool directly. No MCP server needed. The tool would be available to all agents including research subagents.

### 2b. MCP Servers (via `opencode.json` config)

OpenCode supports MCP servers in the user's `opencode.json`:

```json
{
  "mcp": {
    "exa": {
      "type": "remote",
      "url": "https://mcp.exa.ai/mcp",
      "enabled": true
    }
  }
}
```

Or stdio-based:
```json
{
  "mcp": {
    "tavily": {
      "command": "npx",
      "args": ["-y", "tavily-mcp@latest"],
      "env": { "TAVILY_API_KEY": "..." }
    }
  }
}
```

**Implication for us:** Per our plugin invariants, MCPs use **user-wins** precedence. We cannot force-add an MCP server — we can only document it as a user opt-in. But we CAN register a plugin tool (plugin-wins precedence for tools).

---

## 3. MCP Servers for Web Search/Fetch (Category A)

### 3.1 Tavily MCP

| Field | Value |
|-------|-------|
| **Repo** | https://github.com/tavily-ai/tavily-mcp |
| **License** | MIT |
| **What it does** | Real-time web search, content extraction, site mapping, and crawling via Tavily's API |
| **Auth** | API key required (`TAVILY_API_KEY`) |
| **Cost** | Free tier: 1,000 searches/month. Paid plans start ~$50/mo for 5,000 searches. ~$0.01-0.02/search on paid tiers |
| **Install** | `npx -y tavily-mcp@latest` — zero build step |
| **Remote MCP** | `https://mcp.tavily.com/mcp/?tavilyApiKey=<key>` — no local process needed |
| **Maintenance** | Active (215 commits, last updated recently, official from Tavily) |
| **Stars** | 2k |
| **Tools** | `tavily-search`, `tavily-extract`, `tavily-map`, `tavily-crawl` |
| **JS rendering** | Yes — Tavily handles JS-rendered pages server-side |
| **Citation quality** | Returns URLs with titles; no explicit timestamps on results |
| **Research fit** | Excellent — designed for AI agent grounding, returns clean structured results |

### 3.2 Brave Search MCP

| Field | Value |
|-------|-------|
| **Repo** | https://github.com/brave/brave-search-mcp-server |
| **License** | MIT |
| **What it does** | Web search, local search, image/video/news search, AI summarization, LLM-optimized context retrieval |
| **Auth** | API key required (`BRAVE_API_KEY`) |
| **Cost** | Free tier: 2,000 queries/month (web search). Pro plans for local search, extra snippets. ~$0.003/query on paid |
| **Install** | `npx -y @brave/brave-search-mcp-server` — zero build step |
| **Maintenance** | Very active (553 commits, 92 releases, official from Brave, v2.0.80 as of Apr 2026) |
| **Stars** | 1k |
| **Tools** | `brave_web_search`, `brave_local_search`, `brave_news_search`, `brave_image_search`, `brave_video_search`, `brave_summarizer`, `brave_place_search`, `brave_llm_context` |
| **JS rendering** | No — returns indexed content only (pre-crawled by Brave's index) |
| **Citation quality** | Returns URLs with titles and snippets; freshness filter available; `brave_llm_context` includes source metadata |
| **Research fit** | Very good — `brave_llm_context` tool is specifically designed for RAG/agent use. Free tier is generous |

### 3.3 Exa MCP

| Field | Value |
|-------|-------|
| **Repo** | https://github.com/exa-labs/exa-mcp-server |
| **License** | MIT |
| **What it does** | Neural/semantic web search with content extraction, code search, company research, people search |
| **Auth** | API key required (`EXA_API_KEY`), OR use hosted remote MCP with OAuth |
| **Cost** | Free tier: 1,000 searches/month. Paid ~$0.01/search |
| **Install** | Remote: `https://mcp.exa.ai/mcp` (no local install). Local: `npx -y exa-mcp-server` |
| **Maintenance** | Very active (393 commits, official from Exa, 4.4k stars) |
| **Stars** | 4.4k |
| **Tools** | `web_search_exa`, `web_fetch_exa`, `web_search_advanced_exa` |
| **JS rendering** | Yes — Exa crawls and indexes JS-rendered content |
| **Citation quality** | Returns URLs with publish dates, author info, and highlights. Excellent for research |
| **Research fit** | Excellent — semantic search finds conceptually relevant results, not just keyword matches. Category filters (research paper, company, news, personal site) are ideal for research agents |

**Notable:** Exa already has explicit OpenCode configuration in their README:
```json
{
  "mcp": {
    "exa": {
      "type": "remote",
      "url": "https://mcp.exa.ai/mcp",
      "enabled": true
    }
  }
}
```

### 3.4 Firecrawl MCP

| Field | Value |
|-------|-------|
| **Repo** | https://github.com/firecrawl/firecrawl-mcp-server |
| **License** | MIT |
| **What it does** | Web scraping with JS rendering, structured data extraction, site crawling, search, autonomous research agent |
| **Auth** | API key required (`FIRECRAWL_API_KEY`) |
| **Cost** | Free tier: 500 credits/month. Paid starts at $19/mo for 3,000 credits. Scrape = 1 credit, search = 1 credit |
| **Install** | `npx -y firecrawl-mcp` — zero build step |
| **Self-hosted** | Can point to self-hosted Firecrawl instance (no API key needed) |
| **Maintenance** | Very active (270 commits, 6.3k stars, official from Firecrawl/Mendable) |
| **Stars** | 6.3k |
| **Tools** | `firecrawl_scrape`, `firecrawl_search`, `firecrawl_crawl`, `firecrawl_map`, `firecrawl_extract`, `firecrawl_agent`, `firecrawl_batch_scrape` |
| **JS rendering** | Yes — full browser rendering, can interact with pages (click, navigate) |
| **Citation quality** | Returns URLs; structured extraction returns clean JSON |
| **Research fit** | Best for deep scraping and extraction. The `firecrawl_agent` tool does autonomous multi-source research. Overkill for simple search queries |

### 3.5 SearXNG MCP

| Field | Value |
|-------|-------|
| **Repo** | https://github.com/ihor-sokoliuk/mcp-searxng |
| **License** | MIT |
| **What it does** | Web search via self-hosted SearXNG metasearch engine — aggregates results from Google, Bing, DuckDuckGo, etc. |
| **Auth** | No API key — requires a SearXNG instance URL |
| **Cost** | **Free** — SearXNG is open source, self-hosted. Zero per-query cost |
| **Install** | `npx -y mcp-searxng` — zero build step |
| **Maintenance** | Active (200 commits, 771 stars, v1.0.3 Apr 2026) |
| **Stars** | 771 |
| **Tools** | `searxng_web_search`, `web_url_read` |
| **JS rendering** | No — returns search index results only |
| **Citation quality** | Returns URLs with snippets; time filtering available |
| **Research fit** | Good for users who want zero-cost, privacy-first search. Requires running a SearXNG instance (Docker one-liner). Not suitable as a default — too much setup friction |

### 3.6 MCP Fetch (Reference Server)

| Field | Value |
|-------|-------|
| **Repo** | https://github.com/modelcontextprotocol/servers/tree/main/src/fetch |
| **License** | MIT |
| **What it does** | Fetches web content and converts to markdown — essentially the same as OpenCode's built-in `webfetch` |
| **Auth** | None |
| **Cost** | Free |
| **Install** | `npx -y @modelcontextprotocol/server-fetch` |
| **Research fit** | No improvement over built-in `webfetch`. Skip |

---

## 4. OpenCode-Specific Web Tooling (Category B)

**Checked:** OpenCode docs, ecosystem page, GitHub topics

### Findings:

1. **OpenCode's built-in `webfetch`** is the only web tool shipped with OpenCode itself. No search capability.

2. **Exa explicitly documents OpenCode integration** in their README (see 3.3 above). They are the only MCP server that has an OpenCode-specific config example.

3. **OpenCode supports remote MCP servers** (`"type": "remote"`) which means hosted services like Exa and Tavily work without spawning a local process.

4. **No OpenCode-specific web research plugin exists** in the ecosystem. This is a gap our harness could fill.

5. **OpenCode's plugin system** (see Section 2) allows registering custom tools that would be available to all agents. A plugin-owned `websearch` tool would be the lowest-friction path.

---

## 5. Tradeoffs for Top Candidates (Category D)

| Dimension | Brave Search | Tavily | Exa | Firecrawl | SearXNG |
|-----------|-------------|--------|-----|-----------|---------|
| **Citation quality** | Good (URLs + snippets, freshness filter) | Good (URLs + titles, no timestamps on results) | Excellent (URLs + publish dates + highlights) | Good (URLs, structured JSON) | Basic (URLs + snippets) |
| **JS-rendered content** | No (pre-indexed) | Yes (server-side) | Yes (pre-indexed JS content) | Yes (full browser) | No |
| **Rate limits** | 2,000/mo free, then paid | 1,000/mo free, then paid | 1,000/mo free, then paid | 500 credits/mo free | Unlimited (self-hosted) |
| **Cost per 1,000 queries** | ~$3 (paid tier) | ~$10-20 (paid tier) | ~$10 (paid tier) | ~$19/mo for 3k credits | $0 (self-hosted) |
| **Research agent fit** | Very good (`brave_llm_context`) | Excellent (purpose-built for agents) | Excellent (semantic search + categories) | Good for deep scraping, overkill for search | Good if self-hosting |
| **Install friction** | `npx` one-liner | `npx` one-liner or remote URL | Remote URL (zero install) | `npx` one-liner | `npx` + SearXNG instance |
| **Reliability** | High (Brave infrastructure) | High (raised $25M Series A) | High (well-funded) | High (well-funded) | Depends on self-hosted instance |

---

## 6. Alternative In-Process Approaches (Category C)

### Option 1: Plugin-owned `websearch` tool

Our harness plugin registers a custom tool that wraps a search API:

```ts
// In harness-plugin-opencode
export const ResearchPlugin: Plugin = async (ctx) => ({
  tool: {
    websearch: tool({
      description: "Search the web and return results with URLs and snippets",
      args: {
        query: tool.schema.string(),
        count: tool.schema.number().optional().default(10),
      },
      async execute(args) {
        // Call Brave/Tavily/Exa API
        // Requires user to set env var with API key
      },
    }),
  },
})
```

**Pros:**
- Plugin-wins precedence — available to all agents automatically
- No MCP server process overhead
- Can implement caching, deduplication, citation formatting in-process
- Can fall back gracefully if no API key is configured

**Cons:**
- Couples our plugin to a specific search provider (or requires abstraction layer)
- API key management falls on us
- Harder to swap providers than MCP approach

### Option 2: Document MCP server recommendations

Document in our docs which MCP servers users should add for research. User adds to their `opencode.json`.

**Pros:**
- Zero code in our plugin
- User-wins precedence (correct for MCP)
- User picks their preferred provider
- No API key management on our side

**Cons:**
- Friction — user must configure manually
- Research agents don't get search by default
- Can't implement cross-session caching or citation formatting

### Option 3: Hybrid — plugin tool with MCP fallback

Register a lightweight `websearch` tool that:
1. Checks if an MCP search tool is already available (e.g., `tavily-search`, `brave_web_search`)
2. If yes, delegates to it
3. If no, uses `webfetch` with a DuckDuckGo HTML scrape as a zero-config fallback

**Pros:**
- Works out of the box (degraded but functional)
- Upgrades seamlessly when user adds a proper MCP server
- Respects user-wins for MCP

**Cons:**
- DuckDuckGo HTML scraping is fragile and may break
- Complexity of detection logic

---

## 7. Recommendation Buckets (Category E)

### Bucket 1: Low-friction, worth considering as a default

| Candidate | Why |
|-----------|-----|
| **Brave Search MCP** | Most generous free tier (2,000/mo), official maintainer, `npx` install, `brave_llm_context` tool purpose-built for agents. MIT license. No postinstall scripts. |
| **Exa MCP (remote)** | Zero local install (`"type": "remote"`), already documents OpenCode config, semantic search ideal for research, free tier available. MIT license. |

**Action:** Document these as recommended MCP servers in our docs. Provide copy-paste `opencode.json` snippets. Neither requires filesystem writes or postinstall scripts.

### Bucket 2: High-value, but commits users to a paid API key

| Candidate | Why |
|-----------|-----|
| **Tavily MCP** | Best-in-class for agent grounding (benchmarked), JS rendering, remote MCP available. But free tier is only 1,000/mo — power users will hit it fast. |
| **Firecrawl MCP** | Best for deep scraping and structured extraction. The `firecrawl_agent` tool is uniquely powerful. But 500 free credits/mo is tight, and it's overkill for simple search. |

**Action:** Document as "power user" options. Note that Firecrawl can be self-hosted for zero cost.

### Bucket 3: Avoid (for default recommendation)

| Candidate | Why |
|-----------|-----|
| **SearXNG MCP** | Requires running a SearXNG instance — too much setup friction for a default. Good for privacy-conscious users who already run SearXNG. Document as niche option only. |
| **MCP Fetch (reference)** | No improvement over built-in `webfetch`. Skip entirely. |
| **Any MCP server requiring postinstall scripts or binary downloads** | Non-starter per our plugin invariants. None of the above candidates have this problem. |

---

## 8. Recommended Strategy for `@glrs-dev/harness-plugin-opencode`

1. **Short-term (no code change):** Add documentation recommending Brave Search MCP or Exa MCP as user opt-ins. Provide `opencode.json` snippets. This respects user-wins precedence for MCPs.

2. **Medium-term (plugin enhancement):** Consider registering a thin `websearch` custom tool in the plugin that:
   - Checks for `BRAVE_API_KEY` or `EXA_API_KEY` or `TAVILY_API_KEY` env vars
   - If found, calls the corresponding API directly (no MCP overhead)
   - If not found, returns a helpful error message pointing to docs
   - Formats results with stable URLs and timestamps where available
   - Implements in-memory caching within a session

3. **Do NOT:** Add an MCP server as a default (violates user-wins). Do NOT require a postinstall script. Do NOT bundle API keys.

---

## 9. Source Links

- OpenCode Plugins docs: https://opencode.ai/docs/plugins/
- OpenCode Custom Tools docs: https://opencode.ai/docs/custom-tools/
- OpenCode MCP Servers docs: https://opencode.ai/docs/mcp-servers/
- Tavily MCP: https://github.com/tavily-ai/tavily-mcp
- Brave Search MCP: https://github.com/brave/brave-search-mcp-server
- Exa MCP: https://github.com/exa-labs/exa-mcp-server
- Firecrawl MCP: https://github.com/firecrawl/firecrawl-mcp-server
- SearXNG MCP: https://github.com/ihor-sokoliuk/mcp-searxng
- MCP Reference Servers: https://github.com/modelcontextprotocol/servers
- Glama MCP Registry: https://glama.ai/mcp/servers (23,376 servers indexed)
- OpenCode repo: https://github.com/anomalyco/opencode (158k stars, v1.14.48)
