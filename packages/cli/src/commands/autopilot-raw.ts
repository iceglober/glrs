#!/usr/bin/env bun
/**
 * autopilot-raw.ts — standalone OpenCode autopilot runner.
 *
 *   bun autopilot-raw.ts <plan-dir>
 *
 * Uses session.messages() polling for near-real-time tool visibility.
 * SSE is used only for session.idle detection (completion signal).
 */

import { createOpencode } from "@opencode-ai/sdk"
import * as YAML from "yaml"
import * as fs from "node:fs"
import * as path from "node:path"

// ─── CLI ────────────────────────────────────────────────────────────────────
const planDirArg = process.argv[2]
if (!planDirArg) {
  process.stderr.write("Usage: bun autopilot-raw.ts <plan-dir>\n")
  process.exit(1)
}
const PLAN_DIR = path.resolve(planDirArg)
const SPEC_DIR = path.join(PLAN_DIR, "spec")
const MAIN_YAML = path.join(SPEC_DIR, "main.yaml")
const MAX_ITERATIONS = 10
const POLL_INTERVAL_MS = 2000 // poll messages every 2s

if (!fs.existsSync(PLAN_DIR) || !fs.statSync(PLAN_DIR).isDirectory()) {
  process.stderr.write(`Plan dir does not exist: ${PLAN_DIR}\n`)
  process.exit(1)
}

// ─── Logging ────────────────────────────────────────────────────────────────
function log(level: string, msg: string): void {
  const ts = new Date().toTimeString().slice(0, 8)
  process.stderr.write(`${ts} [${level.padEnd(4)}] ${msg}\n`)
}

// ─── Unwrap SDK response ────────────────────────────────────────────────────
function unwrap<T = any>(res: any): T {
  if (res && typeof res === "object" && "data" in res) return res.data as T
  return res as T
}

// ─── Plan helpers ───────────────────────────────────────────────────────────
function listMarkdownFiles(): string[] {
  return fs.readdirSync(PLAN_DIR)
    .filter((f) => f.endsWith(".md") && (f === "main.md" || /^wave_/.test(f)))
    .sort((a, b) => {
      if (a === "main.md") return -1
      if (b === "main.md") return 1
      return a.localeCompare(b, undefined, { numeric: true })
    })
}

function specPathFor(mdFile: string): string {
  return path.join(SPEC_DIR, mdFile.replace(/\.md$/, ".yaml"))
}

function specIsComplete(mdFile: string): boolean {
  const p = specPathFor(mdFile)
  if (!fs.existsSync(p)) return false
  try {
    const data = YAML.parse(fs.readFileSync(p, "utf8")) as any
    if (mdFile === "main.md") return Array.isArray(data?.phases) && data.phases.length > 0
    if (!Array.isArray(data?.items) || data.items.length === 0) return false
    return data.items.every((it: any) => typeof it?.id === "string" && typeof it?.checked === "boolean")
  } catch { return false }
}

function readPhaseItems(specPath: string): Array<{ id: string; checked: boolean }> {
  try {
    const data = YAML.parse(fs.readFileSync(specPath, "utf8")) as any
    return Array.isArray(data?.items) ? data.items : []
  } catch { return [] }
}

function markPhaseCompleted(phaseFile: string): void {
  try {
    const data = YAML.parse(fs.readFileSync(MAIN_YAML, "utf8")) as any
    for (const p of data?.phases ?? []) { if (p.file === phaseFile) p.completed = true }
    fs.writeFileSync(MAIN_YAML, YAML.stringify(data))
  } catch (e) { log("ERR", `Failed to mark ${phaseFile} completed: ${e}`) }
}

// ─── Server + client ───────────────────────────────────────────────────────
const opencode = await createOpencode({ hostname: "127.0.0.1", port: 0, timeout: 30_000 })
const { client, server } = opencode
log("INFO", `Server ready at ${server.url}`)

let shuttingDown = false
async function shutdown(code = 0): Promise<never> {
  if (shuttingDown) process.exit(code)
  shuttingDown = true
  try { await server.close() } catch {}
  process.exit(code)
}
process.on("SIGINT", () => { log("INFO", "SIGINT"); void shutdown(0) })
process.on("SIGTERM", () => { void shutdown(0) })

// ─── SSE idle detection ────────────────────────────────────────────────────
type WaitResult = "idle" | "error" | "timeout"
type Waiter = { sessionId: string; resolve: (r: WaitResult) => void; timer: ReturnType<typeof setTimeout> }
let currentWait: Waiter | null = null

function settle(w: Waiter, r: WaitResult): void {
  clearTimeout(w.timer)
  if (currentWait === w) currentWait = null
  w.resolve(r)
}

function waitForSession(sessionId: string, timeoutMs = 10 * 60 * 1000): Promise<WaitResult> {
  return new Promise((resolve) => {
    const w: Waiter = {
      sessionId, resolve,
      timer: setTimeout(() => { log("ERR", "Timeout"); settle(w, "timeout") }, timeoutMs),
    }
    currentWait = w
  })
}

// SSE consumer — only cares about idle/error
;(async function consumeEvents() {
  try {
    const subscribed: any = await client.event.subscribe()
    const stream: AsyncIterable<any> = subscribed?.stream ?? subscribed?.data?.stream
    if (!stream) { log("ERR", "No SSE stream"); return }
    for await (const evt of stream) {
      const type = (evt as any)?.type ?? ""
      const props = (evt as any)?.properties ?? {} as any
      const w = currentWait as Waiter | null
      if (type === "session.idle" && w && props.sessionID === w.sessionId) {
        settle(w, "idle")
      } else if (type === "session.error" && w && props.sessionID === w.sessionId) {
        const err = props.error?.data?.message ?? props.error?.message ?? "unknown"
        log("ERR", `session.error: ${err}`)
        settle(w, "error")
      }
    }
  } catch (e) { log("ERR", `SSE crashed: ${e}`) }
})()

// ─── Messages poller (near-real-time tool visibility) ──────────────────────
function startPoller(sessionId: string): { stop: () => void } {
  const seenParts = new Set<string>()
  let running = true

  const poll = async () => {
    while (running) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
      if (!running) break
      try {
        const msgs = unwrap<any[]>(await client.session.messages({ path: { id: sessionId } }))
        if (!msgs) continue
        for (const msg of msgs) {
          if (msg?.info?.role !== "assistant") continue
          for (const part of msg?.parts ?? []) {
            if (part?.type !== "tool") continue
            const key = `${part.callID ?? part.id}:${part.state?.status}`
            if (seenParts.has(key)) continue
            seenParts.add(key)

            const tool = part.tool ?? "?"
            const status = part.state?.status ?? "?"
            const title = part.state?.title ?? ""
            const input = part.state?.input
            let arg = ""
            if (input && typeof input === "object") {
              for (const k of ["filePath", "file_path", "path", "command", "pattern", "query"]) {
                const v = (input as any)[k]
                if (typeof v === "string" && v.length > 0) { arg = v.split("\n")[0].slice(0, 80); break }
              }
            }

            if (status === "completed") {
              log("TOOL", `✓ ${tool} ${arg || title}`)
            } else if (status === "error") {
              const err = (part.state?.error ?? "").toString().slice(0, 100)
              log("ERR", `✗ ${tool} ${arg || title} → ${err}`)
            } else if (status === "running") {
              log("TOOL", `▶ ${tool} ${arg || title}`)
            }
          }

          // Cost from latest assistant message
          const cost = msg?.info?.cost
          const tokens = msg?.info?.tokens
          if (cost > 0 && !seenParts.has(`cost:${msg.info.id}`)) {
            seenParts.add(`cost:${msg.info.id}`)
            const parts = [`$${cost.toFixed(4)}`, `in=${tokens?.input ?? 0}`, `out=${tokens?.output ?? 0}`]
            if (tokens?.cache?.read) parts.push(`cache=${tokens.cache.read}`)
            log("COST", parts.join(" | "))
          }
        }
      } catch { /* non-fatal */ }
    }
  }
  poll()
  return { stop: () => { running = false } }
}

// ─── Prompt helper ─────────────────────────────────────────────────────────
async function runPrompt(
  agent: string,
  text: string,
  model?: { providerID: string; modelID: string },
): Promise<{ sessionId: string; result: WaitResult }> {
  const session = unwrap<any>(await client.session.create({ body: {} }))
  const sessionId: string = session?.id
  if (!sessionId) { log("ERR", "No session ID"); return { sessionId: "", result: "error" } }
  log("INFO", `Session: ${sessionId} (${agent}${model ? ` → ${model.providerID}/${model.modelID}` : ""})`)

  const waiter = waitForSession(sessionId)
  const poller = startPoller(sessionId)

  // Fire prompt (non-blocking — SSE drives completion)
  const body: any = { parts: [{ type: "text", text }] }
  if (agent && agent !== "default") body.agent = agent
  if (model) body.model = model

  client.session.prompt({ path: { id: sessionId }, body }).catch((e: any) => {
    log("ERR", `prompt rejected: ${e}`)
    if (currentWait?.sessionId === sessionId) settle(currentWait, "error")
  })

  const result = await waiter
  // Final poll to catch any remaining tool calls
  await new Promise(r => setTimeout(r, 500))
  poller.stop()

  return { sessionId, result }
}

// ─── Enrichment ────────────────────────────────────────────────────────────
function enrichmentPromptForMain(waveYamlFiles: string[]): string {
  const mainRel = path.relative(process.cwd(), path.join(PLAN_DIR, "main.md"))
  const specRel = path.relative(process.cwd(), MAIN_YAML)
  const phaseLines = waveYamlFiles.map((f) => `  - file: ${f}\n    completed: false`).join("\n")
  return `Read the plan at \`${mainRel}\` and write a structured YAML spec to \`${specRel}\` using the file_edit tool.\n\nThe YAML must have this exact shape:\n\n\`\`\`yaml\ntitle: "<plan title>"\ngoal: "<goal text>"\nphases:\n${phaseLines}\n\`\`\`\n\nUse the file_edit tool to create \`${specRel}\`. Output no prose.`
}

function enrichmentPromptForWave(mdFile: string): string {
  const mdRel = path.relative(process.cwd(), path.join(PLAN_DIR, mdFile))
  const specRel = path.relative(process.cwd(), specPathFor(mdFile))
  return `Read the phase plan at \`${mdRel}\` and write a structured YAML spec to \`${specRel}\` using the file_edit tool.\n\nFirst read the markdown. Then read relevant codebase files for context. Write a YAML file:\n\n\`\`\`yaml\nitems:\n  - id: "1.1"\n    intent: "what this does"\n    checked: false\n    files:\n      - path: <relative path>\n        isNew: <bool>\n    verify: "<shell command>"\n\`\`\`\n\nRules:\n- Every item starts with checked: false.\n- Cover every actionable item. Do not invent items.\n- Use the file_edit tool to create \`${specRel}\`. Output no prose.`
}

async function runEnrichment(): Promise<void> {
  log("INFO", "═══ ENRICHMENT ═══")
  const mdFiles = listMarkdownFiles()
  fs.mkdirSync(SPEC_DIR, { recursive: true })
  for (const mdFile of mdFiles) {
    if (specIsComplete(mdFile)) { log("DIM", `Skip ${mdFile}`); continue }
    log("INFO", `Enriching ${mdFile}`)
    const prompt = mdFile === "main.md"
      ? enrichmentPromptForMain(mdFiles.filter(f => f !== "main.md").map(f => f.replace(/\.md$/, ".yaml")))
      : enrichmentPromptForWave(mdFile)
    const { result } = await runPrompt("prime", prompt)
    if (result !== "idle") { log("ERR", `Enrichment ${mdFile}: ${result}`); continue }
    log("INFO", specIsComplete(mdFile) ? `✓ ${mdFile}` : `⚠ ${mdFile} incomplete`)
  }
}

// ─── Execution ─────────────────────────────────────────────────────────────
function executionPrompt(phaseFile: string, yamlText: string): string {
  const specRel = path.relative(process.cwd(), path.join(SPEC_DIR, phaseFile))
  return `You are completing one phase of a plan. The phase spec lives at \`${specRel}\`:\n\n\`\`\`yaml\n${yamlText}\n\`\`\`\n\nComplete every item where checked: false. For each:\n1. Edit or create the files listed.\n2. Run the verify command if present.\n3. Use file_edit to change checked: false to checked: true in \`${specRel}\`.\n\nRules:\n- Do not modify checked: true items.\n- Work in id order.\n- When all items are checked: true, you are done.`
}

async function runExecution(): Promise<void> {
  log("INFO", "═══ EXECUTION ═══")
  if (!fs.existsSync(MAIN_YAML)) { log("ERR", "No spec/main.yaml"); return }
  let phases: Array<{ file: string; completed: boolean }> = []
  try {
    const main = YAML.parse(fs.readFileSync(MAIN_YAML, "utf8")) as any
    phases = main?.phases ?? []
  } catch (e) { log("ERR", `Parse error: ${e}`); return }

  const remaining = phases.filter(p => !p.completed)
  log("INFO", `${phases.length} phases, ${remaining.length} remaining`)
  if (remaining.length === 0) { log("INFO", "All done."); return }

  for (let i = 0; i < remaining.length; i++) {
    const phase = remaining[i]
    log("INFO", `\n═══ PHASE: ${phase.file} (${i + 1}/${remaining.length}) ═══`)
    const specPath = path.join(SPEC_DIR, phase.file)
    if (!fs.existsSync(specPath)) { log("ERR", `Missing: ${specPath}`); continue }

    for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
      const items = readPhaseItems(specPath)
      const unchecked = items.filter(it => !it.checked)
      if (items.length > 0 && unchecked.length === 0) {
        log("INFO", `✓ ${phase.file} complete (${items.length}/${items.length})`)
        markPhaseCompleted(phase.file)
        break
      }

      log("INFO", `Iter ${iter}/${MAX_ITERATIONS} — ${items.length - unchecked.length}/${items.length} done`)
      const yamlText = fs.readFileSync(specPath, "utf8")
      const { result } = await runPrompt("build", executionPrompt(phase.file, yamlText), {
        providerID: "amazon-bedrock", modelID: "zai.glm-5",
      })
      if (result !== "idle") { log("ERR", `Iter ${iter}: ${result}`); break }
    }

    const items = readPhaseItems(specPath)
    if (items.length > 0 && items.every(it => it.checked)) {
      markPhaseCompleted(phase.file)
    } else {
      log("WARN", `${phase.file}: ${items.filter(it => it.checked).length}/${items.length}`)
    }
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────
const phasesRemaining = (() => {
  if (!fs.existsSync(MAIN_YAML)) return "?"
  try { const m = YAML.parse(fs.readFileSync(MAIN_YAML, "utf8")) as any; return (m?.phases ?? []).filter((p: any) => !p.completed).length }
  catch { return "?" }
})()
log("INFO", `Plan: ${PLAN_DIR} (${listMarkdownFiles().length} md, ${phasesRemaining} phases remaining)`)

try {
  await runEnrichment()
  await runExecution()
  log("INFO", "\n✓ Done.")
} catch (e: any) {
  log("ERR", `Fatal: ${e?.stack ?? e}`)
} finally {
  await shutdown(0)
}
