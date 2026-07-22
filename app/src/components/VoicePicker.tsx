import { useEffect, useRef, useState } from "react"
import { Check, Search, Heart } from "lucide-react"
import { toast } from "sonner"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getVoices, postConfig, type Voice } from "@/lib/api"
import { t } from "@/lib/i18n"

export function VoicePicker({
  value,
  defaultVoiceId,
  onChange,
}: {
  value: string
  defaultVoiceId: string
  onChange: (v: string) => void
}) {
  // active voice = explicit choice, else the system default
  const activeId = value || defaultVoiceId
  const [mine, setMine] = useState<Voice[]>([])
  const [q, setQ] = useState("")
  const [results, setResults] = useState<Voice[]>([])
  const [loading, setLoading] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    getVoices().then(setMine)
  }, [])

  function search(term: string) {
    setQ(term)
    if (timer.current) clearTimeout(timer.current)
    if (!term.trim()) {
      setResults([])
      return
    }
    timer.current = setTimeout(async () => {
      setLoading(true)
      setResults(await getVoices(term))
      setLoading(false)
    }, 350)
  }

  async function pick(id: string, title?: string) {
    onChange(id)
    const r = await postConfig({ fishVoiceId: id })
    if (r.ok) toast.success(t("settings.voiceChanged", { title: title ?? id }))
    else toast.error(t("settings.voiceChangeError"))
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="myvoice">{t("settings.myVoices")}</Label>
        <Select
          value={value === defaultVoiceId || mine.some((m) => m.id === value) ? value : undefined}
          onValueChange={(id) => pick(id, mine.find((m) => m.id === id)?.title)}
        >
          <SelectTrigger id="myvoice" className="w-full">
            <SelectValue placeholder={t("settings.jarvisDefault")} />
          </SelectTrigger>
          <SelectContent>
            {[
              { id: defaultVoiceId, title: t("settings.jarvisDefault") },
              ...mine.filter((m) => m.id !== defaultVoiceId),
            ].map((v) => (
              <SelectItem key={v.id} value={v.id}>
                {v.title}
                {v.id === defaultVoiceId && (
                  <Heart className="ml-1 inline size-3 fill-primary align-[-1px] text-primary" aria-label={t("settings.defaultAria")} />
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="voiceq">{t("settings.searchFishLibrary")}</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-faint" />
          <Input
            id="voiceq"
            value={q}
            onChange={(e) => search(e.target.value)}
            placeholder={t("settings.searchPlaceholder")}
            className="pl-7"
            autoComplete="off"
          />
        </div>
        {(loading || results.length > 0) && (
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-1">
            {loading && <div className="px-2 py-1.5 text-xs text-muted-foreground">{t("settings.searching")}</div>}
            {results.map((v) => (
              <Button
                key={v.id}
                variant="ghost"
                className="h-auto w-full justify-start gap-2 px-2 py-1.5 text-left text-xs font-normal"
                onClick={() => pick(v.id, v.title)}
              >
                {activeId === v.id && <Check className="size-3 shrink-0 text-primary" />}
                <span className="flex items-center gap-1 truncate">
                  {v.title}
                  {v.id === defaultVoiceId && (
                    <Heart className="size-3 shrink-0 fill-primary text-primary" aria-label={t("settings.defaultAria")} />
                  )}
                </span>
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
