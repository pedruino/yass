import { useEffect, useState } from "react"
import { Clock, AlertTriangle, MessageSquare, RefreshCw, Volume2, Sparkles, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Hint } from "@/components/ui/hint"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip"
import { getStats, getInsights, speak, type Stats } from "@/lib/api"
import { t } from "@/lib/i18n"

function fmtDur(ms: number) {
  const s = Math.round(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h) return `${h}h ${m}m`
  if (m) return `${m}m ${sec}s`
  return `${sec}s`
}
function rel(ts: number) {
  const d = Math.round((Date.now() - ts) / 1000)
  if (d < 60) return `${d}s`
  if (d < 3600) return `${Math.floor(d / 60)}m`
  if (d < 86400) return `${Math.floor(d / 3600)}h`
  return `${Math.floor(d / 86400)}d`
}

// Compact KPI card. Each card explains its metric on hover (design system, no native title).
function Kpi({ icon, label, value, hint, alert }: { icon: React.ReactNode; label: string; value: string; hint: string; alert?: boolean }) {
  return (
    <Hint text={hint}>
      <div className="flex cursor-help flex-col gap-1.5 rounded-lg border border-border bg-card px-3 py-2.5">
        <span className="flex items-center gap-1 text-[0.65rem] uppercase tracking-[0.12em] text-faint">
          {icon} {label}
        </span>
        <span className={`text-[1.35rem] font-semibold leading-none tabular-nums ${alert ? "text-err" : "text-foreground"}`}>
          {value}
        </span>
      </div>
    </Hint>
  )
}

// Horizontal bars (label, bar, value). Neutral track; only the leader gets the
// full purple, the rest /40 (ranking without oversaturating).
function BarList({ rows, cap }: { rows: { key: string; count: number }[]; cap?: number }) {
  const shown = cap ? rows.slice(0, cap) : rows
  const rest = cap ? rows.length - shown.length : 0
  const max = Math.max(1, ...rows.map((r) => r.count))
  if (rows.length === 0) return <p className="text-[0.8rem] text-faint">{t("stats.noDataYet")}</p>
  return (
    <div className="space-y-2">
      {shown.map((r, i) => (
        <div key={r.key} className="w-full min-w-0">
          <div className="flex items-baseline justify-between gap-2 text-[0.75rem]">
            <Hint text={r.key}>
              <span className="min-w-0 cursor-help truncate text-muted-foreground">
                {r.key}
              </span>
            </Hint>
            <span className="shrink-0 tabular-nums text-foreground">{r.count}</span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${i === 0 ? "bg-primary" : "bg-primary/40"}`}
              style={{ width: `${(r.count / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
      {rest > 0 && <p className="text-[0.7rem] text-faint">{t("stats.moreOthers", { rest })}</p>}
    </div>
  )
}

// Info icon with a design-system Tooltip.
function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className="flex size-6 items-center justify-center rounded-md text-faint transition-colors hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60"
          aria-label={t("stats.explanationAria")}
        >
          <Info className="size-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[220px] text-[0.8rem] leading-snug">{text}</TooltipContent>
    </Tooltip>
  )
}

// Area chart with gradient (timeline / by hour) plus hover and peak.
function AreaChart({ values, labels, unit = t("stats.unitSpeeches") }: { values: number[]; labels?: (i: number) => string; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...values)
  const n = values.length
  const lbl = (i: number) => (labels ? labels(i) : String(i))
  const peak = values.indexOf(Math.max(...values))
  const act = hover ?? peak
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * 100 : 50)
  const y = (v: number) => 38 - (v / max) * 24 // headroom at the top so the tooltip does not touch the peak
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ")
  const area = `${line} L100 40 L0 40 Z`
  const has = values.some((v) => v > 0)

  return (
    <div className="space-y-1">
      <div className="relative h-28">
        {has && values[act] > 0 && (
          <div
            className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-0.5 text-[0.7rem] text-foreground shadow-md"
            style={{ left: `${Math.min(88, Math.max(12, x(act)))}%` }}
          >
            <span className="text-primary">{lbl(act)}</span> · {values[act]} {unit}
          </div>
        )}
        <svg
          viewBox="0 0 100 40"
          preserveAspectRatio="none"
          role="img"
          aria-label={has ? t("stats.chartPeakAria", { peak: lbl(peak), value: values[peak], unit }) : t("stats.chartNoDataAria")}
          className="h-full w-full"
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setHover(Math.min(n - 1, Math.max(0, Math.round(((e.clientX - r.left) / r.width) * (n - 1)))))
          }}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="yass-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.45" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#yass-area)" />
          <path d={line} fill="none" stroke="var(--primary)" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {has && (
            <line x1={x(act)} y1="0" x2={x(act)} y2="40" stroke="var(--primary)" strokeWidth="0.5" strokeDasharray="2 2" opacity="0.4" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
      </div>
      {has && (
        <p className="text-[0.7rem] text-faint">
          {t("stats.peakLabel")} <span className="text-muted-foreground">{lbl(peak)}</span> ({values[peak]} {unit})
        </p>
      )}
    </div>
  )
}

function Section({ title, info, children }: { title: string; info?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <h3 className="flex items-center gap-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-primary">
        {title}
        {info && <InfoTip text={info} />}
      </h3>
      {children}
    </div>
  )
}

/** Inline stats view. Replaces the former Dashboard dialog. */
export function StatsView() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [insight, setInsight] = useState("")
  // Separate status: 'error' distinguishes a load failure from loading (before,
  // both collapsed to stats=null and showed a permanent loading state).
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading")
  const [saying, setSaying] = useState(false) // guard against double-enqueue on the listen button

  // No synchronous insight reset: on refresh the previous text stays until the new
  // one arrives (avoids a flash and a synchronous setState in the effect).
  function load() {
    if (!stats) setStatus("loading")
    getStats()
      .then((s) => { setStats(s); setStatus("ready") })
      .catch(() => setStatus("error"))
    getInsights().then((r) => setInsight(r.text)).catch(() => setInsight(""))
  }
  useEffect(() => {
    // load() fetches on mount and sets status: intentional fetch-on-mount pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="animate-in fade-in slide-in-from-bottom-1 duration-200">
      <div className="mx-auto w-full max-w-6xl space-y-6 px-6 py-4">
        <header className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-[0.95rem] font-bold tracking-wide text-foreground">{t("stats.title")}</h2>
            <p className="mt-0.5 text-[0.75rem] text-muted-foreground">
              {t("stats.subtitle")}
            </p>
          </div>
          <Hint text={t("stats.refreshHint")}>
            <Button size="icon" variant="ghost" className="size-7" onClick={load} aria-label={t("stats.refreshAria")}>
              <RefreshCw className="size-3.5" />
            </Button>
          </Hint>
        </header>

        {status === "error" && !stats ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <AlertTriangle className="size-8 text-err/70" aria-hidden />
            <p className="text-[0.85rem] text-muted-foreground">{t("stats.loadError")}</p>
            <Button size="sm" variant="outline" onClick={load}>
              <RefreshCw className="size-3.5" /> {t("stats.retry")}
            </Button>
          </div>
        ) : !stats ? (
          <div className="w-full space-y-6" aria-hidden>
            <Skeleton className="h-16 w-full rounded-lg" />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
            </div>
            <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
              <Skeleton className="h-32 rounded-lg" />
              <Skeleton className="h-32 rounded-lg" />
            </div>
          </div>
        ) : (
          <TooltipProvider delayDuration={150}>
            <div className="w-full min-w-0 space-y-6">
              <div className="rounded-lg border border-primary/25 bg-primary/5 p-3">
                <div className="mb-1 flex items-center gap-1.5">
                  <Sparkles className="size-3.5 text-primary" />
                  <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-primary">{t("stats.yassExplains")}</span>
                  {insight && (
                    <Hint text={t("stats.listenAnalysisHint")}>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="ml-auto size-6"
                        aria-label={t("stats.listenAria")}
                        disabled={saying}
                        onClick={() => {
                          if (saying) return
                          setSaying(true)
                          speak(insight).finally(() => setSaying(false))
                        }}
                      >
                        <Volume2 className="size-3.5" />
                      </Button>
                    </Hint>
                  )}
                </div>
                <p className="text-[0.85rem] leading-relaxed text-foreground">
                  {insight || t("stats.analyzing")}
                </p>
              </div>

              {/* KPIs */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Kpi icon={<MessageSquare className="size-3" />} label={t("stats.kpiSpeeches")} value={String(stats.total)} hint={t("stats.kpiSpeechesHint")} />
                <Kpi icon={<MessageSquare className="size-3" />} label={t("stats.kpiToday")} value={String(stats.today)} hint={t("stats.kpiTodayHint")} />
                <Kpi icon={<Clock className="size-3" />} label={t("stats.kpiAudio")} value={fmtDur(stats.audioMs)} hint={t("stats.kpiAudioHint")} />
                <Kpi icon={<AlertTriangle className="size-3" />} label={t("stats.kpiErrors")} value={String(stats.errors)} hint={t("stats.kpiErrorsHint")} alert={stats.errors > 0} />
              </div>

              <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
                <Section title={t("stats.byPersonaTitle")} info={t("stats.byPersonaInfo")}>
                  <BarList rows={stats.byPersona} />
                </Section>

                <Section title={t("stats.byWorkspaceTitle")} info={t("stats.byWorkspaceInfo")}>
                  <BarList rows={stats.byWorkspace} cap={6} />
                </Section>
              </div>

              <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
                <Section title={t("stats.last14Title")} info={t("stats.last14Info")}>
                  <AreaChart
                    values={stats.days.map((d) => d.count)}
                    labels={(i) => new Date(stats.days[i].date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                  />
                </Section>

                <Section title={t("stats.byHourTitle")} info={t("stats.byHourInfo")}>
                  <AreaChart values={stats.byHour} labels={(i) => `${i}h`} />
                </Section>
              </div>

              <Section title={t("stats.recentTitle")}>
                <div className="divide-y divide-border rounded-lg border border-border bg-card/40">
                  {stats.recent.length === 0 ? (
                    <p className="px-2.5 py-3 text-[0.8rem] text-faint">{t("stats.nothingYet")}</p>
                  ) : (
                    stats.recent.map((e, i) => (
                      <div key={i} className="flex items-center gap-2 px-2.5 py-1.5">
                        <span className={`size-1.5 shrink-0 rounded-full ${e.status === "error" ? "bg-err" : "bg-primary"}`} />
                        <Hint text={e.summary || t("stats.speechNoSummary", { len: e.textLen })}>
                          <span className="min-w-0 flex-1 cursor-help truncate text-[0.75rem] text-foreground">
                            {e.summary || t("stats.charsCount", { len: e.textLen })}
                          </span>
                        </Hint>
                        <span className="shrink-0 text-[0.7rem] text-faint">{e.persona}</span>
                        <span className="w-8 shrink-0 text-right text-[0.7rem] tabular-nums text-faint">{rel(e.ts)}</span>
                      </div>
                    ))
                  )}
                </div>
              </Section>
            </div>
          </TooltipProvider>
        )}
      </div>
    </div>
  )
}
