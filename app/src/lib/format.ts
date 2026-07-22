import { t } from "@/lib/i18n"

export function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 5) return t("common.time.now")
  if (s < 60) return t("common.time.seconds", { n: s }, "{n}s")
  if (s < 3600) return t("common.time.minutes", { n: Math.floor(s / 60) }, "{n}m")
  if (s < 86400) return t("common.time.hours", { n: Math.floor(s / 3600) }, "{n}h")
  return t("common.time.days", { n: Math.floor(s / 86400) }, "{n}d")
}

const palette = ["#c77dff", "#6bb6ff", "#5cc46a", "#e6b800", "#ff8a65", "#26c6da", "#f06292", "#ba9bff"]
const cache = new Map<string, string>()
let ci = 0
export function wsColor(id: string | null): string {
  const key = id ?? "__default"
  let c = cache.get(key)
  if (!c) {
    c = palette[ci % palette.length]
    cache.set(key, c)
    ci++
  }
  return c
}
