import { useCallback, useEffect, useRef, useState } from "react"
import { API_BASE, playbackEnd, playbackStart, type QueueItem } from "./api"

/**
 * Webview audio sequencer. The daemon synthesizes and serves /audio/<id>; this
 * hook is the output device: it keeps a FIFO of "ready" items, plays one at a
 * time through a single HTMLAudioElement and advances on the `ended` event. It
 * reports playback boundaries to the daemon (/playback/start|end) to keep the
 * tray and NowPlaying consistent.
 *
 * Interaction rules (from UX review findings):
 * - repeat(id) uses the SAME element, never overlapping voices; anything playing
 *   is ended (skip) before the replay, and the queue resumes afterwards.
 * - mute is a real PAUSE: it does not drop the item playing; unmuting resumes
 *   from where it stopped.
 * - autoplay blocked sets `needsUnlock`; any global gesture unlocks it.
 */
export function useYassPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pending = useRef<string[]>([]) // "ready" ids, in arrival order
  const seen = useRef<Set<string>>(new Set())
  const currentId = useRef<string | null>(null)
  const repeating = useRef(false) // one-off replay in progress (outside the queue)
  const reserving = useRef(false) // /playback/start in flight (serializes advance)
  const pausedByMute = useRef(false)
  const mutedRef = useRef(false)
  const unlockedRef = useRef(true) // optimistic; a rejected play() flips it to false
  const advanceRef = useRef<() => void>(() => {})
  const pausedByUser = useRef(false)
  const [needsUnlock, setNeedsUnlock] = useState(false)
  const [progress, setProgress] = useState(0) // 0..1 of the item playing
  const [remainingS, setRemainingS] = useState(0)
  const [paused, setPaused] = useState(false)
  const [volume, setVolumeState] = useState(() => {
    const v = Number(localStorage.getItem("yass-volume"))
    return Number.isFinite(v) && v > 0 && v <= 1 ? v : 1
  })

  const advance = useCallback(() => {
    if (currentId.current || repeating.current || reserving.current) return // already playing/reserving
    if (mutedRef.current || !unlockedRef.current) return
    const id = pending.current.shift()
    if (!id) return
    const a = audioRef.current
    if (!a) return
    // Reserve BEFORE playing (multi-window arbitration): if another webview already
    // claimed this item (409) it never sounds here, avoiding overlapping-voice echo.
    reserving.current = true
    playbackStart(id)
      .then((r) => {
        if (r.status === 409) {
          reserving.current = false
          advanceRef.current() // another window plays this one, move to the next
          return
        }
        a.src = `${API_BASE}/audio/${id}`
        return a
          .play()
          .then(() => {
            currentId.current = id
            reserving.current = false
            setNeedsUnlock(false)
          })
          .catch(() => {
            // autoplay blocked: release the reservation, requeue and ask for a gesture
            reserving.current = false
            void playbackEnd(id).catch(() => {})
            pending.current.unshift(id)
            unlockedRef.current = false
            setNeedsUnlock(true)
          })
      })
      .catch(() => {
        // reservation failed (network/daemon): play anyway, degrading to the old behavior
        a.src = `${API_BASE}/audio/${id}`
        a.play()
          .then(() => {
            currentId.current = id
            reserving.current = false
            setNeedsUnlock(false)
          })
          .catch(() => {
            reserving.current = false
            pending.current.unshift(id)
            unlockedRef.current = false
            setNeedsUnlock(true)
          })
      })
  }, [])

  // Keep the `advance` ref current for the `ended` handler (outside render).
  useEffect(() => {
    advanceRef.current = advance
  }, [advance])

  // Create the audio element once; `ended` reports the end and advances;
  // `timeupdate` feeds progress to the NowPlaying bar.
  useEffect(() => {
    const a = new Audio()
    a.volume = Number(localStorage.getItem("yass-volume")) || 1
    audioRef.current = a
    const onEnded = () => {
      const id = currentId.current
      currentId.current = null
      repeating.current = false
      pausedByUser.current = false
      setPaused(false)
      setProgress(0)
      setRemainingS(0)
      if (id) void playbackEnd(id).catch(() => {})
      advanceRef.current()
    }
    const onTime = () => {
      if (!a.duration || !isFinite(a.duration)) return
      setProgress(a.currentTime / a.duration)
      setRemainingS(Math.max(0, Math.ceil(a.duration - a.currentTime)))
    }
    a.addEventListener("ended", onEnded)
    a.addEventListener("timeupdate", onTime)
    advanceRef.current()
    return () => {
      a.removeEventListener("ended", onEnded)
      a.removeEventListener("timeupdate", onTime)
      a.pause()
    }
  }, [])

  // Item changed state. Only "ready" items (synthesis done, not muted) enter the queue.
  const onItemUpdate = useCallback(
    (item: QueueItem) => {
      if (item.status === "ready" && !seen.current.has(item.id)) {
        seen.current.add(item.id)
        // anti-leak cap for long sessions: drop the oldest (Set preserves order)
        if (seen.current.size > 1000) {
          const oldest = seen.current.values().next().value
          if (oldest) seen.current.delete(oldest)
        }
        pending.current.push(item.id)
        advance()
      }
    },
    [advance],
  )

  // Explicit replay of an item: same element (no overlap), ignores mute
  // (deliberate action), ends whatever was playing and resumes the queue after.
  const repeat = useCallback((id: string) => {
    const a = audioRef.current
    if (!a) return
    const cur = currentId.current
    if (cur) {
      currentId.current = null
      void playbackEnd(cur).catch(() => {})
    }
    repeating.current = true
    pausedByMute.current = false
    pausedByUser.current = false
    setPaused(false)
    a.src = `${API_BASE}/audio/${id}`
    a.play().catch(() => {
      repeating.current = false
      unlockedRef.current = false
      setNeedsUnlock(true)
    })
  }, [])

  const onControl = useCallback(
    (action: "skip" | "stop") => {
      const a = audioRef.current
      if (action === "skip") {
        const id = currentId.current
        if (a && (id || repeating.current)) {
          a.pause()
          currentId.current = null
          repeating.current = false
          if (id) void playbackEnd(id).catch(() => {})
        }
        advance()
      } else {
        // stop: pause and clear the local queue
        if (a) a.pause()
        const id = currentId.current
        currentId.current = null
        repeating.current = false
        pending.current = []
        if (id) void playbackEnd(id).catch(() => {})
      }
    },
    [advance],
  )

  // Mute = real pause: keeps the current item and resumes from the same point on unmute.
  const onMute = useCallback(
    (m: boolean) => {
      mutedRef.current = m
      const a = audioRef.current
      if (m) {
        if (a && (currentId.current || repeating.current)) {
          a.pause()
          pausedByMute.current = true
        }
      } else {
        if (a && pausedByMute.current) {
          pausedByMute.current = false
          void a.play().catch(() => {})
        } else {
          advance()
        }
      }
    },
    [advance],
  )

  // The user's first gesture unlocks playback when autoplay is blocked.
  const unlock = useCallback(() => {
    unlockedRef.current = true
    setNeedsUnlock(false)
    advance()
  }, [advance])

  // Play/pause the item playing (central Spotify-style element). Distinct from
  // mute: a local, resumable pause that never touches daemon state.
  const togglePause = useCallback(() => {
    const a = audioRef.current
    if (!a || (!currentId.current && !repeating.current)) return
    if (a.paused) {
      pausedByUser.current = false
      setPaused(false)
      void a.play().catch(() => {})
    } else {
      pausedByUser.current = true
      setPaused(true)
      a.pause()
    }
  }, [])

  // Volume 0..1, persisted (applied to the live element, so it affects the
  // current item and the next ones).
  const setVolume = useCallback((v: number) => {
    const clamped = Math.min(1, Math.max(0, v))
    setVolumeState(clamped)
    localStorage.setItem("yass-volume", String(clamped))
    const a = audioRef.current
    if (a) a.volume = clamped
  }, [])

  // Seek by fraction (0..1) in the item playing (click on the progress bar).
  const seekTo = useCallback((fraction: number) => {
    const a = audioRef.current
    if (!a || !a.duration || !isFinite(a.duration)) return
    a.currentTime = Math.min(a.duration, Math.max(0, fraction * a.duration))
  }, [])

  return {
    onItemUpdate, onControl, onMute, repeat, needsUnlock, unlock,
    progress, remainingS, paused, togglePause, volume, setVolume, seekTo,
  }
}
