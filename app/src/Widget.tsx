import { useCallback, useEffect, useMemo, useState } from "react"
import { VolumeX, Volume2, WifiOff } from "lucide-react"
import { Header } from "./components/Header"
import { NavRail, type View } from "./components/NavRail"
import { QueueList } from "./components/QueueList"
import { SpeakView } from "./components/SpeakView"
import { StatsView } from "./components/StatsView"
import { SettingsView } from "./components/SettingsView"
import { PronunciationView } from "./components/PronunciationView"
import { WelcomeCard } from "./components/WelcomeCard"
import { PlayerBar } from "./components/PlayerBar"
import { getConfig, subscribeQueue, toggleMute, type Config, type QueueItem } from "./lib/api"
import { useYassPlayer } from "./lib/use-player"
import { cn } from "./lib/utils"
import { t } from "@/lib/i18n"

export default function Widget() {
  const [map, setMap] = useState<Record<string, QueueItem>>({})
  const [connected, setConnected] = useState(false)
  const [config, setConfig] = useState<Config | null>(null)
  const [view, setView] = useState<View>("queue")

  // Audio sequencer in the webview (plays /audio/<id> in order).
  const {
    onItemUpdate, onControl, onMute, repeat, needsUnlock, unlock,
    progress, remainingS, paused, togglePause, volume, setVolume, seekTo,
  } = useYassPlayer()

  const refreshConfig = useCallback(() => {
    getConfig().then(setConfig).catch(() => {}) // daemon down: keep last config, no unhandled rejection
  }, [])

  useEffect(() => {
    refreshConfig()
  }, [refreshConfig])

  // Initial mute state (and changes) feed the player.
  useEffect(() => {
    if (config) onMute(config.muted)
  }, [config?.muted, onMute]) // eslint-disable-line react-hooks/exhaustive-deps

  // Autoplay blocked: any gesture (click/key) unlocks. The banner is a visual
  // reinforcement, not the only path.
  useEffect(() => {
    if (!needsUnlock) return
    const h = () => unlock()
    window.addEventListener("pointerdown", h, { once: true })
    window.addEventListener("keydown", h, { once: true })
    return () => {
      window.removeEventListener("pointerdown", h)
      window.removeEventListener("keydown", h)
    }
  }, [needsUnlock, unlock])

  // ⌘/Ctrl+1..4 shortcuts switch views.
  useEffect(() => {
    const VIEWS: View[] = ["queue", "speak", "stats", "pronunciation", "settings"]
    const h = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const n = Number(e.key)
      if (n >= 1 && n <= VIEWS.length) {
        e.preventDefault()
        setView(VIEWS[n - 1])
      }
    }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [])

  useEffect(() => {
    const upsert = (it: QueueItem) => setMap((m) => ({ ...m, [it.id]: { ...m[it.id], ...it } }))
    return subscribeQueue({
      onConn: (c) => {
        setConnected(c)
        if (c) refreshConfig() // on (re)connect, resync config (covers daemon-down-at-load)
      },
      onInit: (history) => {
        const m: Record<string, QueueItem> = {}
        history.forEach((h) => {
          m[h.id] = h
        })
        setMap(m)
      },
      onEnqueue: upsert,
      onUpdate: (it) => {
        upsert(it)
        onItemUpdate(it) // "ready" enters the webview playback queue
      },
      onControl,
      onMute: (m) => {
        onMute(m)
        refreshConfig()
      },
    })
  }, [onItemUpdate, onControl, onMute, refreshConfig])

  const items = useMemo(() => Object.values(map).sort((a, b) => b.timestamp - a.timestamp), [map])
  // "Up next": queued (synthesizing) + ready (awaiting playback).
  const pendingCount = useMemo(
    () => items.filter((i) => i.status === "queued" || i.status === "ready").length,
    [items],
  )
  const playingItem = items.find((i) => i.status === "playing") ?? null

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <Header connected={connected} queued={pendingCount} muted={config?.muted ?? false} onMuteChange={refreshConfig} />

      {!connected && (
        <div className="flex items-center gap-2 border-b border-border bg-err/10 px-3 py-2 text-[0.7rem] text-err">
          <WifiOff className="size-3.5 shrink-0" aria-hidden />
          <span role="status">{t("app.disconnectedBanner")}</span>
        </div>
      )}
      {config?.muted && (
        <button
          type="button"
          onClick={() => toggleMute().then(refreshConfig)}
          className="flex items-center gap-2 border-b border-border bg-err/10 px-3 py-2 text-left text-[0.7rem] text-err transition-colors hover:bg-err/15"
        >
          <VolumeX className="size-3.5 shrink-0" aria-hidden />
          {t("app.mutedBanner")}
        </button>
      )}
      {needsUnlock && !config?.muted && (
        <button
          type="button"
          onClick={unlock}
          className="flex items-center gap-2 border-b border-border bg-primary/10 px-3 py-2 text-left text-[0.7rem] text-primary transition-colors hover:bg-primary/15"
        >
          <Volume2 className="size-3.5 shrink-0" aria-hidden />
          {t("app.unlockBanner")}
        </button>
      )}

      {/* core: rail + active view */}
      <div className="flex min-h-0 flex-1">
        <NavRail view={view} onNavigate={setView} pendingCount={pendingCount} />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Queue stays mounted (preserves scroll and SSE render); other views mount on demand */}
          <div className={cn("min-h-0 flex-1 flex-col", view === "queue" ? "flex" : "hidden")}>
            {config && !config.fishKeySet ? (
              <WelcomeCard config={config} onConfigure={() => setView("settings")} />
            ) : (
              <QueueList items={items} onRepeat={repeat} />
            )}
          </div>
          {view !== "queue" && (
            <div key={view} className="min-h-0 flex-1 overflow-y-auto">
              {view === "speak" && (
                <SpeakView
                  items={items}
                  muted={config?.muted ?? false}
                  onUnmuted={refreshConfig}
                  needsUnlock={needsUnlock}
                  unlock={unlock}
                  onRepeat={repeat}
                />
              )}
              {view === "stats" && <StatsView />}
              {view === "pronunciation" && <PronunciationView />}
              {view === "settings" && (
                <SettingsView config={config} onChange={refreshConfig} onNavigate={setView} />
              )}
            </div>
          )}
        </main>
      </div>

      {/* persistent player bar: the floor of the UI in any view */}
      <PlayerBar
        item={playingItem}
        progress={progress}
        remainingS={remainingS}
        queued={pendingCount}
        paused={paused}
        onTogglePause={togglePause}
        volume={volume}
        onVolume={setVolume}
        onSeek={seekTo}
      />
    </div>
  )
}
