import { BarChart3, ListMusic, MessageSquareText, Settings2, SpellCheck2 } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Separator } from "@/components/ui/separator"
import { Hint } from "@/components/ui/hint"
import { cn } from "@/lib/utils"
import { t } from "@/lib/i18n"

export type View = "queue" | "speak" | "stats" | "pronunciation" | "settings"

const ITEMS: { id: View; label: string; icon: LucideIcon }[] = [
  { id: "queue", label: t("app.navQueue"), icon: ListMusic },
  { id: "speak", label: t("app.navSpeak"), icon: MessageSquareText },
  { id: "stats", label: t("app.navStats"), icon: BarChart3 },
  { id: "pronunciation", label: t("app.navPronunciation"), icon: SpellCheck2 },
]

function RailButton({
  id,
  label,
  icon: Icon,
  active,
  badge,
  onClick,
}: {
  id: View
  label: string
  icon: LucideIcon
  active: boolean
  badge?: boolean
  onClick: (v: View) => void
}) {
  return (
    <div className="relative flex w-full justify-center">
      {/* active indicator: bar on the rail's left edge */}
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full bg-primary",
          "origin-center transition-transform duration-200 ease-out",
          active ? "scale-y-100" : "scale-y-0",
        )}
      />
      <Hint text={label} side="right">
        <button
          type="button"
          aria-current={active ? "page" : undefined}
          aria-label={label}
          onClick={() => onClick(id)}
          className={cn(
            "relative flex size-11 items-center justify-center rounded-md transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60",
            active
              ? "bg-accent text-primary"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
          )}
        >
          <Icon className="size-5" strokeWidth={active ? 2.25 : 1.75} aria-hidden />
          {badge && (
            <span
              className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-primary"
              aria-hidden
            />
          )}
        </button>
      </Hint>
    </div>
  )
}

/**
 * Spotify-style side navigation: thin icon rail, active view with pill + purple
 * edge bar. Settings anchored at the bottom. Zero popups.
 */
export function NavRail({
  view,
  onNavigate,
  pendingCount,
}: {
  view: View
  onNavigate: (v: View) => void
  pendingCount: number
}) {
  return (
    <nav
      aria-label={t("app.navAriaLabel")}
      className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-border bg-background py-2"
    >
      {ITEMS.map((it) => (
        <RailButton
          key={it.id}
          {...it}
          active={view === it.id}
          badge={it.id === "queue" && view !== "queue" && pendingCount > 0}
          onClick={onNavigate}
        />
      ))}
      <div className="mt-auto" />
      <Separator className="my-1 w-6" />
      <RailButton
        id="settings"
        label={t("app.navSettings")}
        icon={Settings2}
        active={view === "settings"}
        onClick={onNavigate}
      />
    </nav>
  )
}
