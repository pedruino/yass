import { Volume2, VolumeX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Hint, HintTerm } from "@/components/ui/hint"
import { FontScale } from "./FontScale"
import { toggleMute } from "@/lib/api"
import { cn } from "@/lib/utils"
import { t } from "@/lib/i18n"

/**
 * Lean header: identity + global state (connection, queue, mute) + font.
 * Navigation lives in NavRail; transport (skip/stop) lives in PlayerBar.
 * Tooltips always via the design system (Hint), never native `title`.
 */
export function Header({
  connected,
  queued,
  muted,
  onMuteChange,
}: {
  connected: boolean
  queued: number
  muted: boolean
  onMuteChange: () => void
}) {
  return (
    <header className="flex items-center gap-2 border-b border-border px-3 py-2">
      <Hint text={connected ? t("app.connHintOnline") : t("app.connHintOffline")}>
        <span
          className={cn("size-1.5 shrink-0 cursor-help rounded-full transition-colors", connected ? "bg-ok" : "bg-err")}
          aria-hidden
        />
      </Hint>
      <span className="sr-only" role="status">
        {connected ? t("app.connStatusOnline") : t("app.connStatusOffline")}
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="flex shrink-0 items-center gap-1.5 text-xs font-bold tracking-[0.18em] text-primary">
          <Volume2 className="size-3.5 shrink-0" aria-hidden />
          <HintTerm text={t("app.brandHint")}>
            Y.A.S.S.
          </HintTerm>
        </span>
        <span className="hidden truncate text-[0.7rem] font-medium tracking-tight text-faint sm:inline">
          {t("app.subtitle")}
        </span>
      </span>
      {queued > 0 && (
        <Hint text={queued === 1 ? t("app.queuedHintSingular", { n: queued }) : t("app.queuedHintPlural", { n: queued })}>
          <Badge className="h-4 cursor-help px-1.5 text-[0.65rem] tabular-nums" aria-label={t("app.queuedAria", { n: queued })}>
            {queued}
          </Badge>
        </Hint>
      )}
      <div className="ml-auto flex items-center gap-0.5">
        <Hint text={muted ? t("app.muteHintUnmute") : t("app.muteHintMute")}>
          <Button
            size="icon"
            variant="ghost"
            className={cn("size-7", muted && "text-err")}
            aria-label={muted ? t("app.muteAriaUnmute") : t("app.muteAriaMute")}
            aria-pressed={muted}
            onClick={() => toggleMute().then(onMuteChange)}
          >
            {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
          </Button>
        </Hint>
        <Separator orientation="vertical" className="mx-1 h-4" />
        <FontScale />
      </div>
    </header>
  )
}
