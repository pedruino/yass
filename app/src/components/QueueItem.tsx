import { useState } from "react"
import { Play, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Hint, HintTerm } from "@/components/ui/hint"
import { StatusBadge } from "./StatusBadge"
import { relTime, wsColor } from "@/lib/format"
import { reenqueue, type QueueItem as TItem } from "@/lib/api"
import { cn } from "@/lib/utils"
import { t } from "@/lib/i18n"

export function QueueItem({ item, onRepeat }: { item: TItem; onRepeat: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const failed = item.status === "error"

  function retry() {
    reenqueue(item)
      .then((r) => {
        if (!r?.ok) throw new Error()
        toast.success(t("app.requeued"))
      })
      .catch(() => toast.error(t("app.requeueFailed")))
  }

  return (
    <div
      role="listitem"
      className={cn(
        "group border-b border-border/60 px-3 py-2 transition-colors last:border-0 hover:bg-accent/40",
        item.status === "playing" && "bg-primary/5 ring-1 ring-primary/30 ring-inset",
      )}
    >
      {/* meta + controls: always visible on the top row */}
      <div className="flex items-center gap-1.5 text-[0.7rem] text-faint">
        <span className="size-2 shrink-0 rounded-full" style={{ background: wsColor(item.session ?? item.workspaceId) }} aria-hidden />
        {item.terminalName && (
          <>
            <span className="shrink-0">{item.terminalName}</span>
            <span className="text-faint/60">·</span>
          </>
        )}
        <span className="truncate">{item.projectName ?? item.workspaceName ?? "·"}</span>
        {item.tabName && (
          <>
            <span className="text-faint/60">·</span>
            <span className="truncate">{item.tabName}</span>
          </>
        )}
        {item.session && (
          <HintTerm text={t("app.sessionHint")} className="shrink-0 font-mono text-faint/60">
            #{item.session.slice(0, 4)}
          </HintTerm>
        )}
        {item.origin === "user" && (
          <HintTerm
            text={t("app.userSpeechHint")}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-1.5 text-[0.65rem] font-semibold text-primary"
          >
            {t("app.userSpeechBadge")}
          </HintTerm>
        )}
        <time className="ml-auto shrink-0" dateTime={new Date(item.timestamp).toISOString()}>
          {relTime(item.timestamp)}
        </time>
        <StatusBadge status={item.status} />
        {failed ? (
          <Hint text={t("app.retryHint")}>
            <Button
              size="icon"
              variant="outline"
              className="size-7 shrink-0"
              aria-label={t("app.retryAria")}
              onClick={retry}
            >
              <RotateCcw className="size-3" />
            </Button>
          </Hint>
        ) : (
          item.audioReady && (
            <Hint text={t("app.repeatHint")}>
              <Button
                size="icon"
                variant="outline"
                className="size-7 shrink-0"
                aria-label={t("app.repeatAria")}
                onClick={() => onRepeat(item.id)}
              >
                <Play className="size-3" />
              </Button>
            </Hint>
          )
        )}
      </div>

      {/* Main content = what was SPOKEN. Jarvis's voice (rewritten) is purple
          italic to set it apart from the literal text; the agent's raw input
          stays collapsed and appears on expand. */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "mt-1 block w-full cursor-pointer rounded-sm text-left text-sm leading-relaxed break-words whitespace-pre-wrap focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60",
          item.summary ? "italic text-primary/85" : "text-foreground",
          !expanded && "line-clamp-2",
        )}
        aria-expanded={expanded}
        aria-label={expanded ? t("app.collapseAria") : t("app.expandAria")}
      >
        {item.summary || item.text}
      </button>
      {expanded && item.summary && (
        <div className="mt-2 border-l-2 border-border pl-2">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-faint">{t("app.inputLabel")}</p>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-[0.75rem] leading-relaxed text-muted-foreground">
            {item.text}
          </p>
        </div>
      )}
      {failed && item.error && (
        <p className="mt-1 text-[0.7rem] text-err">
          {item.error}
        </p>
      )}
    </div>
  )
}
