// @ts-nocheck
#!/usr/bin/env bun
/**
 * one-off-execa.ts — Start server via Bun.spawn, attach client, test message.part.updated
 *
 * Usage: bun one-off-execa.ts "your prompt"
 */

import { createOpencodeClient } from "@opencode-ai/sdk"

const prompt = process.argv.slice(2).join(" ")
if (!prompt) {
  console.error('Usage: bun one-off-execa.ts "your prompt"')
  process.exit(1)
}

const CWD = process.cwd()

function log(level: string, msg: string) {
  const ts = new Date().toTimeString().slice(0, 8)
  process.stderr.write(`${ts} [${level.padEnd(4)}] ${msg}\n`)
}

// Start server via Bun.spawn
log("INFO", "Starting opencode serve...")
const proc = Bun.spawn(["opencode", "serve", "--port=0"], {
  cwd: CWD,
  stdout: "pipe",
  stderr: "pipe",
  env: { ...process.env },
})

// Wait for server URL from stdout
const serverUrl = await new Promise<string>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Server start timeout")), 30_000)
  let output = ""

  const reader = proc.stdout.getReader()
  const read = async () => {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      output += new TextDecoder().decode(value)
      const match = output.match(/listening on (http:\/\/[^\s]+)/)
      if (match) {
        clearTimeout(timeout)
        resolve(match[1])
        return
      }
    }
    clearTimeout(timeout)
    reject(new Error("Server stdout ended without URL"))
  }
  read()
})

log("INFO", `Server ready: ${serverUrl}`)

// Give the server a moment to fully initialize
await new Promise(r => setTimeout(r, 1000))

// Create client
const client = createOpencodeClient({ baseUrl: serverUrl })
log("INFO", "Client connected")

// Create session
const sessionRes = await client.session.create({ body: { title: prompt.slice(0, 60) } })
const sessionId = (sessionRes.data as any)?.id
if (!sessionId) {
  log("ERR", `No session ID: ${JSON.stringify(sessionRes.data)}`)
  proc.kill()
  process.exit(1)
}
log("INFO", `Session: ${sessionId}`)

// Subscribe to events
const events = await client.event.subscribe()
log("INFO", "SSE subscribed")

// Event consumer — log EVERYTHING
let eventCount = 0
const eventLoop = (async () => {
  const stream = (events as any).stream ?? (events as any).data?.stream
  if (!stream) {
    log("ERR", "No stream from subscribe")
    return
  }
  for await (const evt of stream as AsyncIterable<any>) {
    eventCount++
    const type = evt?.type ?? "?"
    const props = evt?.properties ?? {}

    if (type === "server.heartbeat") continue

    // Log raw type + truncated props for everything
    const propsStr = JSON.stringify(props)
    const truncated = propsStr.length > 300 ? propsStr.slice(0, 300) + "…" : propsStr
    log("SSE", `${type} → ${truncated}`)

    if (type === "session.idle" && props.sessionID === sessionId) {
      log("INFO", `Session idle — done (${eventCount} total events)`)
      break
    }
    if (type === "session.error" && props.sessionID === sessionId) {
      log("ERR", `Session error — stopping`)
      break
    }
  }
})()

// Send prompt (fire and forget)
log("INFO", `Sending prompt (${prompt.length} chars)...`)
client.session.prompt({
  path: { id: sessionId },
  body: {
    parts: [{ type: "text", text: prompt }],
    model: { providerID: "amazon-bedrock", modelID: "zai.glm-5" },
  },
}).catch(e => log("ERR", `prompt rejected: ${e}`))

// Wait for event loop to finish (session.idle or error)
await eventLoop

log("INFO", `Done. ${eventCount} events observed.`)
proc.kill()
process.exit(0)
