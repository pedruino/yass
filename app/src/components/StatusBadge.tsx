import { Clock, Volume2, Check, TriangleAlert, type LucideIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Hint } from "@/components/ui/hint"
import { cn } from "@/lib/utils"
import { t } from "@/lib/i18n"
import type { QueueStatus } from "@/lib/api"

// Lifecycle names in plain language (no internal jargon) with a tooltip for
// each. Color is reserved for active states; "done" is terminal and neutral,
// since 90% of the list is terminal and colored badges would become noise.
const MAP: Record<QueueStatus, { label: string; hint: string; icon: LucideIcon; cls: string; pulse?: boolean }> = {
  queued: {
    label: t("app.statusQueuedLabel"),
    hint: t("app.statusQueuedHint"),
    icon: Clock,
    cls: "text-warn border-warn/30 bg-warn/10",
  },
  ready: {
    label: t("app.statusReadyLabel"),
    hint: t("app.statusReadyHint"),
    icon: Volume2,
    cls: "text-primary border-primary/30 bg-primary/10",
  },
  playing: {
    label: t("app.statusPlayingLabel"),
    hint: t("app.statusPlayingHint"),
    icon: Volume2,
    cls: "text-primary border-primary/30 bg-primary/10",
    pulse: true,
  },
  done: {
    label: t("app.statusDoneLabel"),
    hint: t("app.statusDoneHint"),
    icon: Check,
    cls: "text-faint border-border bg-transparent",
  },
  error: {
    label: t("app.statusErrorLabel"),
    hint: t("app.statusErrorHint"),
    icon: TriangleAlert,
    cls: "text-err border-err/30 bg-err/10",
  },
}

export function StatusBadge({ status }: { status: QueueStatus }) {
  const s = MAP[status] ?? MAP.done
  const Icon = s.icon
  return (
    <Hint text={s.hint}>
      <Badge
        variant="outline"
        className={cn("cursor-help gap-1 px-1.5 py-0 text-[0.7rem] font-semibold tracking-wide", s.cls, s.pulse && "animate-pulse")}
      >
        <Icon className="size-3" aria-hidden />
        {s.label}
      </Badge>
    </Hint>
  )
}
