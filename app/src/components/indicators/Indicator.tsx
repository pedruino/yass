import { createElement, useEffect, useRef } from "react"
import { INDICATORS, useIndicator } from "@/lib/indicators"
import type { QueueItem } from "@/lib/api"

// Renders the chosen style, preserving each style's identity.
//  - With `item` (envelope+startedAt+durationMs): keeps the style's own
//    animation and modulates scale/glow by speech energy (--energy), so it
//    reacts to the voice instead of becoming a "generic bar".
//  - Without an envelope (or ⚙ preview via `styleId`): decorative CSS loop.
export function Indicator({ item, styleId }: { item?: QueueItem | null; styleId?: string }) {
  const live = useIndicator()
  const id = styleId ?? live
  const def = INDICATORS.find((d) => d.id === id) ?? INDICATORS[0]
  const ref = useRef<HTMLSpanElement>(null)

  const env = item?.envelope
  const synced = !styleId && !!env && env.length > 0 && !!item?.startedAt && !!item?.durationMs

  useEffect(() => {
    const el = ref.current
    if (!synced || !el || !env) return
    const started = item!.startedAt as number
    const dur = item!.durationMs as number
    let curE = 0
    let raf = 0

    const tick = () => {
      const t = (Date.now() - started) / dur
      const center = Math.min(env.length - 1, Math.max(0, Math.floor(t * env.length)))
      // energy = mean of the central window
      let s = 0
      let c = 0
      for (let i = -2; i <= 2; i++) {
        const idx = center + i
        if (idx >= 0 && idx < env.length) {
          s += env[idx]
          c++
        }
      }
      const e = c ? s / c : 0
      curE += (e - curE) * 0.4
      el.style.setProperty("--energy", curE.toFixed(3))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      el.style.removeProperty("--energy")
    }
  }, [synced, item?.id, item?.startedAt, item?.durationMs, def.id, env])

  return (
    <span ref={ref} className={def.cls + (synced ? " ind-synced" : "")} aria-hidden>
      {Array.from({ length: def.count }, (_, i) => createElement(def.tag, { key: i }))}
    </span>
  )
}
