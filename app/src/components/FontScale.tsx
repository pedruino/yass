import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Hint } from "@/components/ui/hint"
import { t } from "@/lib/i18n"

const KEY = "yass-font"
const MIN = 12
const MAX = 22
const DEFAULT = 14

export function FontScale() {
  const [size, setSize] = useState<number>(() => {
    const s = Number(localStorage.getItem(KEY))
    return s >= MIN && s <= MAX ? s : DEFAULT
  })

  useEffect(() => {
    document.documentElement.style.fontSize = `${size}px`
    localStorage.setItem(KEY, String(size))
  }, [size])

  return (
    <div className="flex items-center gap-0.5" role="group" aria-label={t("app.fontSizeGroup")}>
      <Hint text={t("app.fontDecreaseHint")}>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 font-semibold"
          aria-label={t("app.fontDecreaseAria")}
          onClick={() => setSize((s) => Math.max(MIN, s - 1))}
          disabled={size <= MIN}
        >
          <span className="text-xs">A−</span>
        </Button>
      </Hint>
      <Hint text={t("app.fontIncreaseHint")}>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 font-semibold"
          aria-label={t("app.fontIncreaseAria")}
          onClick={() => setSize((s) => Math.min(MAX, s + 1))}
          disabled={size >= MAX}
        >
          <span className="text-sm">A+</span>
        </Button>
      </Hint>
    </div>
  )
}
