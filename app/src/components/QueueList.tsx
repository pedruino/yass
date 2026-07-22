import { useMemo, useState } from "react"
import { Search, Volume2 } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import { QueueItem } from "./QueueItem"
import type { QueueItem as TItem } from "@/lib/api"
import { t } from "@/lib/i18n"

export function QueueList({ items, onRepeat }: { items: TItem[]; onRepeat: (id: string) => void }) {
  const [q, setQ] = useState("")

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase()
    if (!n) return items
    return items.filter((it) =>
      [it.text, it.summary, it.workspaceName, it.tabName]
        .filter(Boolean)
        .some((s) => (s as string).toLowerCase().includes(n)),
    )
  }, [items, q])

  // "Up next": pending items in playback order (FIFO), highlighted above the
  // history. Without this, ready items sink into the middle of the done ones.
  const pending = useMemo(
    () =>
      filtered
        .filter((it) => it.status === "queued" || it.status === "ready")
        .sort((a, b) => a.timestamp - b.timestamp),
    [filtered],
  )
  const past = useMemo(
    () => filtered.filter((it) => it.status !== "queued" && it.status !== "ready"),
    [filtered],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {items.length > 0 && (
        <div className="relative shrink-0 border-b border-border px-2 py-1.5">
          <Search className="absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("app.searchPlaceholder")}
            className="h-7 pl-7 text-[0.85rem]"
          />
        </div>
      )}
      <ScrollArea className="min-h-0 flex-1">
        <div aria-label={t("app.queueAriaLabel")}>
          {items.length === 0 ? (
            <div className="flex h-56 select-none flex-col items-center justify-center gap-2 px-6 text-center">
              <Volume2 className="size-8 text-faint/40" aria-hidden />
              <p className="text-[0.85rem] font-medium text-muted-foreground">{t("app.emptyTitle")}</p>
              <p className="text-[0.75rem] text-faint">{t("app.emptyHint")}</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-56 select-none flex-col items-center justify-center gap-1.5 px-6 text-center">
              <Search className="size-7 text-faint/40" aria-hidden />
              <p className="text-[0.8rem] text-faint">{t("app.noMatch")}</p>
            </div>
          ) : (
            <>
              {pending.length > 0 && (
                <section aria-label={t("app.upNextAria", { n: pending.length })}>
                  <h2 className="border-b border-border bg-primary/[0.04] px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-wider text-primary/80">
                    {t("app.upNextHeading")} · {pending.length}
                  </h2>
                  <div role="list">
                    {pending.map((it) => (
                      <QueueItem key={it.id} item={it} onRepeat={onRepeat} />
                    ))}
                  </div>
                  {past.length > 0 && (
                    <h2 className="border-b border-border px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-wider text-faint">
                      {t("app.historyHeading")}
                    </h2>
                  )}
                </section>
              )}
              <div role="list">
                {past.map((it) => (
                  <QueueItem key={it.id} item={it} onRepeat={onRepeat} />
                ))}
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
