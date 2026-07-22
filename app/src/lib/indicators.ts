import { useEffect, useState } from "react"
import { postConfig } from "./api"
import { t } from "@/lib/i18n"

// Catalog of "speaking" indicator styles. Each one's CSS lives in index.css
// (.{cls} classes); pure CSS loops (transform/opacity) are fluid by construction.
// Top 10 from pulse-lab.
export type IndicatorTag = "span" | "i" | "u" | "s" | "b"

// kind defines how the style is driven by the speech envelope:
//  bars   each bar's height = amplitude in the window (real rhythm + level)
//  matrix grid; global brightness follows speech energy (--energy)
//  led    row; number of lit LEDs follows speech energy (--energy)
export type IndicatorKind = "bars" | "matrix" | "led"

export interface IndicatorDef {
  id: string
  label: string
  cls: string
  tag: IndicatorTag
  count: number
  kind: IndicatorKind
}

export const INDICATORS: IndicatorDef[] = [
  { id: "gl-5", label: t("common.indicator.gl5"), cls: "gl5-bar", tag: "u", count: 4, kind: "bars" },
  { id: "wf-1", label: t("common.indicator.wf1"), cls: "wf1-bar", tag: "span", count: 5, kind: "bars" },
  { id: "wf-3", label: t("common.indicator.wf3"), cls: "wf3-bar", tag: "span", count: 5, kind: "bars" },
  { id: "wf-5", label: t("common.indicator.wf5"), cls: "wf5-bar", tag: "span", count: 4, kind: "bars" },
  { id: "wf-6", label: t("common.indicator.wf6"), cls: "wf6-bar", tag: "span", count: 6, kind: "bars" },
  { id: "gl-1", label: t("common.indicator.gl1"), cls: "gl1-bar", tag: "i", count: 5, kind: "bars" },
  { id: "rt-2", label: t("common.indicator.rt2"), cls: "rt2-bar", tag: "b", count: 9, kind: "matrix" },
  { id: "rt-4", label: t("common.indicator.rt4"), cls: "rt4-bvu", tag: "s", count: 4, kind: "bars" },
  { id: "rt-6", label: t("common.indicator.rt6"), cls: "rt6-bled", tag: "u", count: 4, kind: "led" },
  { id: "gr-2", label: t("common.indicator.gr2"), cls: "gr2-bar", tag: "i", count: 5, kind: "bars" },
]

export const DEFAULT_INDICATOR = "gl-5"

const KEY = "yass-indicator"
const EVT = "yass-indicator-change"

export function getIndicator(): string {
  try {
    const v = localStorage.getItem(KEY)
    return v && INDICATORS.some((d) => d.id === v) ? v : DEFAULT_INDICATOR
  } catch {
    return DEFAULT_INDICATOR
  }
}

export function setIndicator(id: string): void {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    /* localStorage unavailable: proceed with the event only */
  }
  window.dispatchEvent(new CustomEvent(EVT, { detail: id }))
  // persist to the daemon so the tray (Rust process) reflects the style
  void postConfig({ indicator: id })
}

// Reactive hook: reflects live changes (Settings to NowPlaying) without prop drilling.
export function useIndicator(): string {
  const [id, setId] = useState(getIndicator)
  useEffect(() => {
    const onChange = (e: Event) => setId((e as CustomEvent<string>).detail ?? getIndicator())
    window.addEventListener(EVT, onChange)
    return () => window.removeEventListener(EVT, onChange)
  }, [])
  return id
}
