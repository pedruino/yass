import { useEffect, useRef, useState } from "react"
import { Pause, Play, SkipForward, Square, Volume1, Volume2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Hint } from "@/components/ui/hint"
import { cmd, type QueueItem } from "@/lib/api"
import { Indicator } from "./indicators/Indicator"
import { cn } from "@/lib/utils"
import { t } from "@/lib/i18n"

function fmtRemaining(s: number) {
  const m = Math.floor(s / 60)
  const r = s % 60
  return `-${m}:${String(r).padStart(2, "0")}`
}

/**
 * Persistent player bar (Spotify anatomy): progress hairline with seek,
 * now-playing, central play/pause, skip/stop, and volume. The "speak for me"
 * composer lives in its own tab (SpeakView); here it's playback only.
 */
export function PlayerBar({
  item,
  progress,
  remainingS,
  queued,
  paused,
  onTogglePause,
  volume,
  onVolume,
  onSeek,
}: {
  item: QueueItem | null
  progress: number
  remainingS: number
  queued: number
  paused: boolean
  onTogglePause: () => void
  volume: number
  onVolume: (v: number) => void
  onSeek: (fraction: number) => void
}) {
  const playing = item !== null

  // "Stop all" discards the queue: 1st click arms (red, 3s), 2nd executes.
  const [stopArmed, setStopArmed] = useState(false)
  const armTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(armTimer.current), [])

  function handleStop() {
    if (!stopArmed) {
      setStopArmed(true)
      clearTimeout(armTimer.current)
      armTimer.current = setTimeout(() => setStopArmed(false), 3000)
      return
    }
    clearTimeout(armTimer.current)
    setStopArmed(false)
    void cmd("/stop")
  }

  return (
    <footer className="relative shrink-0 border-t border-border bg-card">
      {/* progress with seek: click positions the speech (generous click area) */}
      <button
        type="button"
        role="slider"
        aria-label={t("app.seekAria")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={playing ? Math.round(progress * 100) : 0}
        aria-valuetext={playing ? t("app.seekValuePlaying", { pct: Math.round(progress * 100) }) : t("app.seekValueIdle")}
        disabled={!playing}
        onClick={(e) => {
          if (e.detail === 0) return // synthetic keyboard click (Enter/Space) has clientX=0: ignore, else it jumps to start
          const r = e.currentTarget.getBoundingClientRect()
          onSeek((e.clientX - r.left) / r.width)
        }}
        onKeyDown={(e) => {
          if (!playing) return
          if (e.key === "ArrowRight") { e.preventDefault(); onSeek(Math.min(1, progress + 0.05)) }
          else if (e.key === "ArrowLeft") { e.preventDefault(); onSeek(Math.max(0, progress - 0.05)) }
          else if (e.key === "Home") { e.preventDefault(); onSeek(0) }
          else if (e.key === "End") { e.preventDefault(); onSeek(1) }
        }}
        className="group absolute inset-x-0 -top-1.5 z-10 h-3 cursor-pointer rounded-full focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60 disabled:cursor-default"
      >
        <span className="absolute inset-x-0 top-1.5 block h-[2px] bg-primary/10 transition-[height] group-hover:h-[4px] group-hover:-translate-y-[1px]">
          <span
            className="block h-full bg-primary shadow-[0_0_6px_var(--primary)] transition-[width] duration-300 ease-linear"
            style={{ width: `${playing ? Math.min(100, progress * 100) : 0}%` }}
          />
        </span>
      </button>

      <div className="flex h-12 items-center gap-2 px-3 pt-1">
        {/* now-playing / idle: live region, screen readers announce the speech change */}
        <div className="flex min-w-0 flex-1 items-center gap-2" aria-live="polite">
          {playing ? (
            <>
              <Indicator item={item} />
              <span className="shrink-0 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-primary">
                {paused ? t("app.statePaused") : t("app.statePlaying")}
              </span>
              <span className="min-w-0 flex-1 truncate text-[0.8rem] text-foreground">
                {item.summary || item.text}
              </span>
              {remainingS > 0 && (
                <span className="shrink-0 text-[0.7rem] tabular-nums text-faint">
                  {fmtRemaining(remainingS)}
                </span>
              )}
            </>
          ) : (
            <>
              <span className="shrink-0 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-faint">
                {t("app.stateIdle")}
              </span>
              <span className="min-w-0 flex-1 truncate text-[0.8rem] text-faint">
                {queued > 0 ? t("app.queuedInLine", { n: queued }) : t("app.nothingQueued")}
              </span>
            </>
          )}
        </div>

        {/* transport: central play/pause (Spotify pattern) + skip + stop */}
        <div className="ml-1 flex shrink-0 items-center gap-0.5">
          <Hint text={paused ? t("app.pauseHintResume") : t("app.pauseHintPause")}>
            <Button
              size="icon"
              variant="ghost"
              className="size-9 rounded-full bg-foreground/5 hover:bg-foreground/10"
              disabled={!playing}
              aria-label={paused ? t("app.pauseAriaResume") : t("app.pauseAriaPause")}
              onClick={onTogglePause}
            >
              {paused ? <Play className="size-4.5" /> : <Pause className="size-4.5" />}
            </Button>
          </Hint>
          <Hint text={t("app.skipHint")}>
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              disabled={!playing}
              aria-label={t("app.skipAria")}
              onClick={() => cmd("/skip")}
            >
              <SkipForward className="size-4" />
            </Button>
          </Hint>
          {stopArmed && (
            <span className="shrink-0 text-[0.65rem] font-medium text-err" aria-hidden>
              {t("app.confirmStop")}
            </span>
          )}
          <Hint text={stopArmed ? t("app.stopHintArmed") : t("app.stopHintIdle")}>
            <Button
              size="icon"
              variant="ghost"
              className={cn(
                "size-8 transition-colors",
                stopArmed && "bg-err/15 text-err hover:bg-err/25 hover:text-err",
              )}
              disabled={!playing && queued === 0}
              aria-label={stopArmed ? t("app.stopAriaArmed") : t("app.stopAriaIdle")}
              onClick={handleStop}
            >
              <Square className="size-4" />
            </Button>
          </Hint>
        </div>

        {/* volume (persisted) */}
        <div className="ml-2 flex shrink-0 items-center gap-1.5">
          {volume < 0.5 ? (
            <Volume1 className="size-4 text-faint" aria-hidden />
          ) : (
            <Volume2 className="size-4 text-faint" aria-hidden />
          )}
          <Hint text={t("app.volumeHint", { pct: Math.round(volume * 100) })}>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => onVolume(Number(e.target.value))}
              aria-label={t("app.volumeAria")}
              aria-valuetext={`${Math.round(volume * 100)}%`}
              className="h-1 w-20 cursor-pointer appearance-none rounded-full bg-muted accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60"
            />
          </Hint>
        </div>
      </div>
    </footer>
  )
}
