import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import { Loader2, MessageSquareText, Play, RefreshCw, Send, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Hint } from "@/components/ui/hint"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  getQuickPhrases,
  QUICK_PHRASE_DEFAULTS,
  speak,
  toggleMute,
  type QueueItem,
  type QuickPhraseSource,
} from "@/lib/api"
import { relTime } from "@/lib/format"
import { t } from "@/lib/i18n"

/**
 * "Speak for me" tab: the user types and Jarvis speaks the text EXACTLY
 * (literal, no rewrite). Each utterance here is marked deliberate
 * (origin 'user') and listed below to repeat with one click.
 */
export function SpeakView({
  items,
  muted,
  onUnmuted,
  needsUnlock,
  unlock,
  onRepeat,
}: {
  items: QueueItem[]
  muted: boolean
  onUnmuted: () => void
  needsUnlock: boolean
  unlock: () => void
  onRepeat: (id: string) => void
}) {
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const histIdx = useRef(-1)

  // Deliberate utterances (most recent first), from the global history via SSE.
  const mine = useMemo(() => items.filter((i) => i.origin === "user"), [items])

  // Dynamic quick phrases: derived from what the user says most (ranking +
  // LLM synthesis in the daemon). Seeded with defaults so it is never empty.
  const [phrases, setPhrases] = useState<string[]>(QUICK_PHRASE_DEFAULTS)
  const [phraseSource, setPhraseSource] = useState<QuickPhraseSource>("default")
  const [phrasesLoading, setPhrasesLoading] = useState(true)

  function loadPhrases() {
    setPhrasesLoading(true)
    getQuickPhrases()
      .then((d) => {
        setPhrases(d.phrases)
        setPhraseSource(d.source)
      })
      .finally(() => setPhrasesLoading(false))
  }

  // Fetch on mount and re-fetch (debounced) when new user utterances arrive, so
  // the suggestions track what you say most.
  useEffect(() => {
    const t = setTimeout(loadPhrases, mine.length ? 400 : 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine.length])

  async function say(value: string) {
    if (!value.trim() || sending) return
    setSending(true)
    try {
      if (needsUnlock) unlock()
      if (muted) {
        await toggleMute()
        onUnmuted()
        toast.info(t("speak.soundReactivated"))
      }
      const r = await speak(value.trim())
      if (!r?.ok) throw new Error("invalid response")
      histIdx.current = -1
      setText("")
    } catch {
      toast.error(t("speak.sendQueueError"))
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    void say(text)
  }

  // ArrowUp/Down navigate previous utterances (quick recall).
  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const hist = mine.map((m) => m.text)
    if (e.key === "ArrowUp") {
      const next = Math.min(histIdx.current + 1, hist.length - 1)
      if (next >= 0 && hist[next] !== undefined) {
        e.preventDefault()
        histIdx.current = next
        setText(hist[next])
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault()
      const next = histIdx.current - 1
      histIdx.current = Math.max(next, -1)
      setText(next >= 0 ? hist[next] : "")
    }
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-1 duration-200">
      <div className="mx-auto w-full max-w-5xl space-y-5 px-6 py-4">
        <header>
          <h2 className="flex items-center gap-1.5 text-[0.95rem] font-bold tracking-wide text-foreground">
            <MessageSquareText className="size-4 text-primary" /> {t("speak.title")}
          </h2>
          <p className="mt-0.5 text-[0.75rem] text-muted-foreground">
            {t("speak.subtitle")}
          </p>
        </header>

        {/* main composer */}
        <form onSubmit={submit} className="flex items-center gap-2">
          <Input
            ref={inputRef}
            autoFocus
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              histIdx.current = -1
            }}
            onKeyDown={handleKeyDown}
            placeholder={t("speak.inputPlaceholder")}
            aria-label={t("speak.inputAria")}
            disabled={sending}
            maxLength={600}
            className="h-11 text-[0.95rem] focus-visible:ring-1 focus-visible:ring-primary/40"
          />
          <Button
            type="submit"
            size="icon"
            className="size-11 shrink-0"
            disabled={!text.trim() || sending}
            aria-label={t("speak.speakAria")}
          >
            {sending ? (
              <Loader2 className="size-4.5 animate-spin" aria-hidden />
            ) : (
              <Send className="size-4.5" aria-hidden />
            )}
          </Button>
        </form>

        {/* two columns: quick phrases | history of your utterances */}
        <div className="grid items-start gap-5 md:grid-cols-2">
        {/* quick phrases: one click speaks it instantly */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-primary">
              {t("speak.quickPhrases")}
            </span>
            {phraseSource !== "default" && (
              <Hint text={t("speak.quickPhrasesHint")}>
                <span className="inline-flex cursor-help items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-1.5 text-[0.6rem] font-medium text-primary">
                  <Sparkles className="size-2.5" /> {t("speak.suggestedBadge")}
                </span>
              </Hint>
            )}
            <Hint text={t("speak.refreshHint")}>
              <Button
                size="icon"
                variant="ghost"
                className="ml-auto size-6"
                aria-label={t("speak.refreshAria")}
                disabled={phrasesLoading}
                onClick={loadPhrases}
              >
                <RefreshCw className={`size-3 ${phrasesLoading ? "animate-spin" : ""}`} />
              </Button>
            </Hint>
          </div>
          {phrasesLoading ? (
            <div className="flex flex-wrap gap-1.5">
              {[64, 44, 92, 72, 120].map((w, i) => (
                <Skeleton key={i} className="h-8 rounded-full" style={{ width: w }} />
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {phrases.map((phrase) => (
                <button
                  key={phrase}
                  type="button"
                  disabled={sending}
                  onClick={() => void say(phrase)}
                  className="rounded-full border border-border bg-muted/40 px-3 py-1.5 text-[0.8rem] text-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60 disabled:opacity-50"
                >
                  {phrase}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* history of deliberate utterances */}
        <section className="space-y-2.5">
          <h3 className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-primary">
            {t("speak.yourSpeech")}
          </h3>
          {mine.length === 0 ? (
            <p className="text-[0.8rem] text-faint">{t("speak.emptyHistory")}</p>
          ) : (
            <div className="divide-y divide-border rounded-lg border border-border bg-card/40">
              {mine.map((m) => (
                <div key={m.id} className="flex items-center gap-2 px-2.5 py-2">
                  <span className="min-w-0 flex-1 truncate text-[0.85rem] text-foreground">
                    {m.text}
                  </span>
                  <span className="shrink-0 text-[0.7rem] tabular-nums text-faint">
                    {relTime(m.timestamp)}
                  </span>
                  {m.audioReady && (
                    <Hint text={t("speak.repeatHint")}>
                      <Button
                        size="icon"
                        variant="outline"
                        className="size-7 shrink-0"
                        aria-label={t("speak.repeatAria")}
                        onClick={() => onRepeat(m.id)}
                      >
                        <Play className="size-3.5" />
                      </Button>
                    </Hint>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
        </div>
      </div>
    </div>
  )
}
