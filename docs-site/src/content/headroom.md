# Headroom

Context compression for LLM sessions. Compresses tool outputs, logs, files, and conversation history before they reach the model. 60-95% fewer tokens, same answers.

Powered by [headroom-ai](https://github.com/chopratejas/headroom). Runs entirely local — no data leaves your machine.

## Install

```bash
glrs headroom init
```

Installs headroom-ai if missing, starts the compression proxy, and configures OpenCode to route through it. One command.

## How it works

```
OpenCode → headroom proxy (localhost:8787) → Anthropic/Bedrock/OpenAI
                    ↓
            SmartCrusher (JSON)
            CodeCompressor (AST)
            Kompress-base (text)
            CacheAligner (prefix stability)
```

The proxy intercepts all LLM traffic, compresses the context, and forwards to the provider. Originals are stored locally — the LLM can retrieve them on demand (CCR).

## Commands

| Command | What it does |
|---|---|
| `glrs headroom init` | Install, start proxy, configure OpenCode |
| `glrs headroom start` | Start the proxy |
| `glrs headroom stop` | Stop the proxy, restore direct provider access |
| `glrs headroom status` | Proxy health, token savings, compression ratio |

Any other arguments are passed through to the `headroom` CLI directly.

## What gets compressed

- Tool outputs (bash, read, grep results)
- Large file contents
- Conversation history (older turns)
- RAG chunks and search results

## What doesn't change

- Your API keys stay in your environment — the proxy forwards them
- Model selection, temperature, and other parameters pass through unchanged
- The LLM sees compressed content but can retrieve originals via CCR if it needs the full text

## Disabling

```bash
glrs headroom stop
```

Stops the proxy and removes the provider redirect from `opencode.json`. Traffic goes direct to the provider again.
