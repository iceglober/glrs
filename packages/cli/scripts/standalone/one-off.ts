// @ts-nocheck
import { createWriteStream } from "node:fs"
import { once } from "node:events"
import { createOpencode } from "@opencode-ai/sdk"

type Wrapped<T> = T | { data: T }

type Session = {
  id: string
}

type MessageInfo = {
  id?: string
  cost?: unknown
  tokens?: unknown
}

type PromptResponse = MessageInfo | { info?: MessageInfo }

type ToolState = {
  status?: "pending" | "running" | "completed" | "error" | string
  input?: unknown
  output?: unknown
  error?: unknown
  title?: string
  metadata?: unknown
  time?: unknown
}

type ToolPart = {
  type: "tool"
  id: string
  sessionID?: string
  messageID?: string
  callID: string
  tool: string
  metadata?: unknown
  state?: ToolState
}

type SessionMessage = {
  info?: {
    id?: string
  }
  parts?: unknown[]
}

type SessionCreatedEvent = {
  type: "session.created"
  properties: {
    info: {
      id: string
      parentID?: string
    }
  }
}

type MessagePartUpdatedEvent = {
  type: "message.part.updated"
  properties: {
    part: unknown
  }
}

type OpenCodeEvent =
  | SessionCreatedEvent
  | MessagePartUpdatedEvent
  | {
    type: string
    properties?: unknown
  }

type ToolLogRecord = {
  type: "tool_call"
  observedAt: string
  sessionID: string
  messageID: string
  partID: string
  callID: string
  tool: string
  status?: string
  input?: unknown
  output?: unknown
  error?: unknown
  title?: string
  metadata?: unknown
  time?: unknown
}

const prompt = process.argv.slice(2).join(" ")

if (!prompt) {
  console.error('Usage: bun run-opencode.ts "your task"')
  process.exit(1)
}

const model = process.env.OPENCODE_MODEL ?? "amazon-bedrock/zai.glm-5"
const awsRegion = process.env.AWS_REGION ?? "us-east-1"
const awsProfile = process.env.AWS_PROFILE
const steps = Number(process.env.OPENCODE_STEPS ?? 40)
const toolLogPath = process.env.OPENCODE_TOOL_LOG ?? "opencode-tool-calls.jsonl"
const debugEvents = process.env.OPENCODE_DEBUG_EVENTS === "1"

const permission = {
  read: {
    "*": "allow",
    "*.env": "deny",
    "*.env.*": "deny",
    "*.env.local": "deny",
    "*.env.production": "deny",
    "*.env.example": "allow",
  },
  edit: "allow",
  glob: "allow",
  grep: "allow",
  bash: {
    "*": "allow",
    "rm *": "deny",
    "rm -rf *": "deny",
    "sudo *": "deny",
    "git push *": "deny",
    "git commit *": "deny",
    "git reset *": "deny",
    "git clean *": "deny",
  },
  task: "allow",
  skill: "allow",
  lsp: "allow",
  webfetch: "allow",
  websearch: "allow",
  question: "deny",
  external_directory: "deny",
  doom_loop: "deny",
} as const

function unwrap<T>(value: Wrapped<T>): T {
  if (value && typeof value === "object" && "data" in value) {
    return value.data
  }

  return value
}

function modelBody(value: string): { providerID: string; modelID: string } | undefined {
  const index = value.indexOf("/")

  if (index === -1) {
    return undefined
  }

  return {
    providerID: value.slice(0, index),
    modelID: value.slice(index + 1),
  }
}

function hasStringProperty<T extends string>(
  value: object,
  property: T,
): value is Record<T, string> {
  return property in value && typeof (value as Record<T, unknown>)[property] === "string"
}

function isToolPart(part: unknown): part is ToolPart {
  if (!part || typeof part !== "object") {
    return false
  }

  if (!("type" in part) || part.type !== "tool") {
    return false
  }

  return (
    hasStringProperty(part, "id") &&
    hasStringProperty(part, "callID") &&
    hasStringProperty(part, "tool")
  )
}

function compactToolPart(part: ToolPart): ToolLogRecord {
  const state = part.state ?? {}

  const record: ToolLogRecord = {
    type: "tool_call",
    observedAt: new Date().toISOString(),
    sessionID: part.sessionID ?? "unknown",
    messageID: part.messageID ?? "unknown",
    partID: part.id,
    callID: part.callID,
    tool: part.tool,
    status: state.status,
    input: state.input,
    metadata: state.metadata ?? part.metadata,
    time: state.time,
  }

  if (state.title !== undefined) {
    record.title = state.title
  }

  if (state.status === "completed") {
    record.output = state.output
  }

  if (state.status === "error") {
    record.error = state.error
  }

  return record
}

function logToolPart(
  part: ToolPart,
  seen: Map<string, string>,
  log: NodeJS.WritableStream,
): void {
  const record = compactToolPart(part)
  const key = [
    record.sessionID,
    record.messageID,
    record.callID,
    record.partID,
    record.status,
  ].join(":")

  const line = JSON.stringify(record)

  if (seen.get(key) === line) {
    return
  }

  seen.set(key, line)
  log.write(`${line}\n`)

  const title = record.title ? ` - ${record.title}` : ""
  console.error(`[${record.status ?? "unknown"}] ${record.tool}${title}`)
}

function withSessionContext(
  rawPart: ToolPart,
  sessionID: string,
  messageID?: string,
): ToolPart {
  return {
    ...rawPart,
    sessionID: rawPart.sessionID ?? sessionID,
    messageID: rawPart.messageID ?? messageID ?? "unknown",
  }
}

async function main(): Promise<void> {
  const opencode = await createOpencode({
    config: {
      model,
      small_model: model,
      provider: {
        "amazon-bedrock": {
          options: {
            region: awsRegion,
            ...(awsProfile ? { profile: awsProfile } : {}),
          },
        },
      },
      permission,
      agent: {
        build: {
          mode: "primary",
          steps,
          permission,
        },
      },
    },
  })

  const { client, server } = opencode
  const log = createWriteStream(toolLogPath, { flags: "a" })
  const abort = new AbortController()
  const seen = new Map<string, string>()
  const trackedSessions = new Set<string>()

  try {
    const session = unwrap<Session>(
      await client.session.create({
        body: {
          title: prompt.slice(0, 80),
        },
      }),
    )

    trackedSessions.add(session.id)

    const events = await client.event.subscribe({
      signal: abort.signal,
    })

    const eventLoop = (async (): Promise<void> => {
      try {
        for await (const rawEvent of events.stream as AsyncIterable<OpenCodeEvent>) {
          // Log ALL events with truncated content
          const props = (rawEvent as any).properties
          const propsStr = props ? JSON.stringify(props) : ""
          const truncated = propsStr.length > 300 ? propsStr.slice(0, 300) + "…" : propsStr
          if (rawEvent.type !== "server.heartbeat") {
            console.error(`[SSE] ${rawEvent.type} → ${truncated}`)
          }

          if (rawEvent.type === "session.created") {
            const event = rawEvent as SessionCreatedEvent
            const child = event.properties.info

            if (child.parentID && trackedSessions.has(child.parentID)) {
              trackedSessions.add(child.id)
            }

            continue
          }

          if (rawEvent.type !== "message.part.updated") {
            continue
          }

          const event = rawEvent as MessagePartUpdatedEvent
          const rawPart = event.properties.part

          if (!isToolPart(rawPart)) {
            continue
          }

          const part = withSessionContext(rawPart, rawPart.sessionID ?? session.id)

          if (!trackedSessions.has(part.sessionID ?? session.id)) {
            continue
          }

          logToolPart(part, seen, log)
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          throw error
        }
      }
    })()

    const response = unwrap<PromptResponse>(
      await client.session.prompt({
        path: {
          id: session.id,
        },
        body: {
          model: modelBody(model),
          parts: [
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      }),
    )

    const messages = unwrap<SessionMessage[]>(
      await client.session.messages({
        path: {
          id: session.id,
        },
      }),
    )

    if (debugEvents) {
      const partTypes = messages
        .flatMap((message) => message.parts ?? [])
        .map((part) =>
          typeof part === "object" && part && "type" in part
            ? String(part.type)
            : typeof part,
        )

      console.error("persisted part types", partTypes)
    }

    for (const message of messages) {
      for (const rawPart of message.parts ?? []) {
        if (!isToolPart(rawPart)) {
          continue
        }

        const part = withSessionContext(rawPart, session.id, message.info?.id)
        logToolPart(part, seen, log)
      }
    }

    abort.abort()

    await Promise.race([
      eventLoop,
      new Promise((resolve) => setTimeout(resolve, 500)),
    ])

    const info = "info" in response && response.info ? response.info : response

    console.log(
      JSON.stringify(
        {
          sessionID: session.id,
          messageID: info.id,
          cost: info.cost,
          tokens: info.tokens,
          model,
          awsRegion,
          toolLog: toolLogPath,
        },
        null,
        2,
      ),
    )
  } finally {
    abort.abort()
    log.end()
    await once(log, "finish")
    server.close()
  }
}

await main()