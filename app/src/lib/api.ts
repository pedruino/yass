import { toast } from "sonner"
import { t } from "@/lib/i18n"

// API base. The UI can be served by the daemon (same-origin), Vite (proxy) or
// Tauri (tauri://localhost). An absolute URL works for all three since the
// daemon replies with CORS open. Override at build via VITE_YASS_API.
export const API_BASE: string = import.meta.env.VITE_YASS_API ?? "http://localhost:3891"

// "ready" = synthesis done, waiting for the webview to play (audio now plays in
// the webview, not the daemon).
export type QueueStatus = "queued" | "ready" | "playing" | "done" | "error"

export interface QueueItem {
  id: string
  timestamp: number
  text: string
  workspaceId: string | null
  workspaceName: string | null
  tabId: string | null
  tabName: string | null
  /** Terminal-agnostic context from the Claude hook (project dir basename + session id + terminal). */
  projectName?: string | null
  session?: string | null
  terminalName?: string | null
  status: QueueStatus
  audioReady?: boolean
  error?: string
  skipSummary?: boolean
  /** 'user' = deliberate speech typed in the Speak tab; 'agent' = automatic narration. */
  origin?: "user" | "agent"
  summary?: string | null
  envelope?: number[]
  durationMs?: number
  startedAt?: number
}

export interface Config {
  fishKeySet: boolean
  fishVoiceId: string
  defaultVoiceId: string
  openaiKeySet: boolean
  persona: string
  muted: boolean
  indicator?: string
}

export interface Voice {
  id: string
  title: string
  self: boolean
}

export interface Persona {
  id: string
  label: string
}

export interface ConfigPatch {
  fishApiKey?: string
  fishVoiceId?: string
  openaiApiKey?: string
  persona?: string
  indicator?: string
}

interface QueueHandlers {
  onInit: (history: QueueItem[], queued: string[]) => void
  onEnqueue: (item: QueueItem) => void
  onUpdate: (item: QueueItem) => void
  onConn?: (connected: boolean) => void
  // Control from the daemon (may originate from tray/hotkey), relayed to the player.
  onControl?: (action: "skip" | "stop") => void
  onMute?: (muted: boolean) => void
}

export function subscribeQueue(h: QueueHandlers): () => void {
  let es: EventSource | null = null
  let closed = false
  let retry: ReturnType<typeof setTimeout> | undefined

  function connect() {
    es = new EventSource(API_BASE + "/events")
    es.addEventListener("init", (e) => {
      h.onConn?.(true)
      const d = JSON.parse((e as MessageEvent).data)
      h.onInit(d.history ?? [], d.queued ?? [])
    })
    es.addEventListener("enqueue", (e) => h.onEnqueue(JSON.parse((e as MessageEvent).data)))
    es.addEventListener("update", (e) => h.onUpdate(JSON.parse((e as MessageEvent).data)))
    es.addEventListener("control", (e) => h.onControl?.(JSON.parse((e as MessageEvent).data).action))
    es.addEventListener("mute", (e) => h.onMute?.(JSON.parse((e as MessageEvent).data).muted))
    es.onerror = () => {
      h.onConn?.(false)
      es?.close()
      if (!closed) retry = setTimeout(connect, 3000)
    }
  }
  connect()

  return () => {
    closed = true
    if (retry) clearTimeout(retry)
    es?.close()
  }
}

const json = (r: Response) => r.json()

export const getConfig = (): Promise<Config> => fetch(API_BASE + "/config").then(json)

export const postConfig = (patch: ConfigPatch): Promise<{ ok: boolean; error?: string }> =>
  fetch(API_BASE + "/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).then(json)

export const getVoices = (q = ""): Promise<Voice[]> =>
  fetch(API_BASE + `/voices?q=${encodeURIComponent(q)}`).then(json).catch(() => [])

export const getPersonas = (): Promise<Persona[]> =>
  fetch(API_BASE + "/personas").then(json).catch(() => [])

export interface ClaudeIntegration {
  installed: boolean
  wired: boolean
  enabled: boolean
}

export const getClaudeIntegration = (): Promise<ClaudeIntegration> =>
  fetch(API_BASE + "/claude-integration").then(json).catch(() => ({ installed: false, wired: false, enabled: false }))

export const setClaudeIntegration = (enabled: boolean): Promise<ClaudeIntegration> =>
  fetch(API_BASE + "/claude-integration", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  }).then(json)

export const speak = (text: string): Promise<{ ok: boolean }> =>
  fetch(API_BASE + "/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  }).then(json)

// Skip/Stop with feedback: a silent failure was invisible to the user.
export const cmd = (path: "/skip" | "/stop"): Promise<void> =>
  fetch(API_BASE + path, { method: "POST" })
    .then((r) => {
      if (!r.ok) toast.error(t("common.cmd.failed", { status: r.status }, "Falha ao executar ({status})"))
    })
    .catch(() => {
      toast.error(t("common.daemon.down"))
    })

// Re-enqueue a failed item (synthesis retry) preserving its literal mode.
export const reenqueue = (item: QueueItem): Promise<{ ok: boolean }> =>
  fetch(API_BASE + "/enqueue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: item.text,
      workspaceId: item.workspaceId,
      tabId: item.tabId,
      skipSummary: item.skipSummary ?? false,
    }),
  }).then(json)

// The webview reports the real playback boundaries to the daemon (source of
// truth for "what is playing"; the tray animates from startedAt+durationMs).
export const playbackStart = (id: string): Promise<Response> =>
  fetch(API_BASE + "/playback/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) })

export const playbackEnd = (id: string): Promise<Response> =>
  fetch(API_BASE + "/playback/end", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) })

export interface StatItem {
  key: string
  count: number
}
export interface StatEvent {
  ts: number
  status: string
  persona: string
  voiceId?: string
  workspace: string | null
  tab: string | null
  durationMs: number
  textLen: number
  summary: string | null
}
export interface Stats {
  total: number
  errors: number
  audioMs: number
  today: number
  byPersona: StatItem[]
  byWorkspace: StatItem[]
  byHour: number[]
  days: { date: number; count: number }[]
  recent: StatEvent[]
}

export const getStats = (): Promise<Stats> => fetch(API_BASE + "/stats").then(json)

export const getInsights = (): Promise<{ text: string }> =>
  fetch(API_BASE + "/insights").then(json).catch(() => ({ text: "" }))

// Quick phrases ("Speak for me"). Local fallback when the daemon is unreachable
// or has no history. Spoken verbatim, so the pt-BR text is the value.
export const QUICK_PHRASE_DEFAULTS = [
  t("common.quickPhrase.yes"),
  t("common.quickPhrase.no"),
  t("common.quickPhrase.thanks"),
  t("common.quickPhrase.oneMoment"),
  t("common.quickPhrase.repeat"),
  t("common.quickPhrase.noVoice"),
]

export type QuickPhraseSource = "ai" | "frequency" | "default"
export interface QuickPhrases {
  phrases: string[]
  source: QuickPhraseSource
}

// Ready-made phrases derived from what the user speaks most (ranking + LLM
// synthesis in the daemon). Fail-soft: falls back to defaults if the endpoint fails.
export const getQuickPhrases = (): Promise<QuickPhrases> =>
  fetch(API_BASE + "/quick-phrases")
    .then(json)
    .then((d: QuickPhrases) =>
      Array.isArray(d?.phrases) && d.phrases.length
        ? d
        : { phrases: QUICK_PHRASE_DEFAULTS, source: "default" as const },
    )
    .catch(() => ({ phrases: QUICK_PHRASE_DEFAULTS, source: "default" as const }))

export type Glossary = Record<string, string>

export const getGlossary = (): Promise<Glossary> =>
  fetch(API_BASE + "/glossary").then(json).catch(() => ({}))

export const setGlossaryTerm = (
  term: string,
  phonetic: string,
): Promise<{ ok: boolean; count?: number; error?: string }> =>
  fetch(API_BASE + "/glossary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ term, phonetic }),
  }).then(json)

export const removeGlossaryTerm = (
  term: string,
): Promise<{ ok: boolean; count?: number; error?: string }> =>
  fetch(API_BASE + "/glossary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ term, remove: true }),
  }).then(json)

export const toggleMute = (): Promise<{ muted: boolean }> =>
  fetch(API_BASE + "/toggle-mute", { method: "POST" }).then(json)
