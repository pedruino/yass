import { useEffect, useMemo, useState } from "react"
import { Plus, Trash2, Volume2, Search } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Hint } from "@/components/ui/hint"
import { Input } from "@/components/ui/input"
import {
  getGlossary,
  setGlossaryTerm,
  removeGlossaryTerm,
  speak,
  type Glossary,
} from "@/lib/api"
// Aliased: local `t` (term) variables below shadow the name.
import { t as tr } from "@/lib/i18n"

// Pronunciation glossary editor (phonetics). Term to how it should be spoken.
// Applies to the daemon (applyGlossary) before TTS: hot-reload, no restart.
export function PronunciationEditor() {
  const [gloss, setGloss] = useState<Glossary>({})
  const [q, setQ] = useState("")
  const [term, setTerm] = useState("")
  const [phon, setPhon] = useState("")

  async function load() {
    setGloss(await getGlossary())
  }
  useEffect(() => {
    // fetch-on-mount of the glossary; async setState after the await is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [])

  const entries = useMemo(() => {
    const all = Object.entries(gloss).sort((a, b) => a[0].localeCompare(b[0]))
    if (!q.trim()) return all
    const needle = q.trim().toLowerCase()
    return all.filter(([t, p]) => t.includes(needle) || p.toLowerCase().includes(needle))
  }, [gloss, q])

  async function add() {
    const t = term.trim().toLowerCase()
    const p = phon.trim()
    if (!t || !p) {
      toast(tr("pronunciation.fillFields"))
      return
    }
    const r = await setGlossaryTerm(t, p)
    if (r.ok) {
      toast.success(tr("pronunciation.addedToast", { t, p }))
      setTerm("")
      setPhon("")
      setGloss((g) => ({ ...g, [t]: p }))
    } else {
      toast.error(r.error || tr("pronunciation.saveError"))
    }
  }

  async function remove(t: string) {
    const r = await removeGlossaryTerm(t)
    if (r.ok) {
      setGloss((g) => {
        const n = { ...g }
        delete n[t]
        return n
      })
    } else {
      toast.error(r.error || tr("pronunciation.removeError"))
    }
  }

  const total = Object.keys(gloss).length

  return (
    <div className="space-y-3">
      <p className="text-[0.7rem] text-faint">
        <span className="tabular-nums text-muted-foreground">{tr("pronunciation.termCount", { n: total })}</span>
        {q.trim() && total !== entries.length && (
          <> · <span className="tabular-nums text-muted-foreground">{tr("pronunciation.filteredCount", { n: entries.length })}</span></>
        )}{" "}
        · {tr("pronunciation.termToHowSpeak")}
      </p>

      {/* add: term to pronunciation */}
      <div className="flex items-center gap-1.5 rounded-lg border border-border bg-card/40 p-2">
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={tr("pronunciation.termPlaceholder")}
          className="h-9 flex-1"
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <span className="shrink-0 text-faint" aria-hidden>→</span>
        <Input
          value={phon}
          onChange={(e) => setPhon(e.target.value)}
          placeholder={tr("pronunciation.pronPlaceholder")}
          className="h-9 flex-1"
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <Hint text={tr("pronunciation.addHint")}>
          <Button size="icon" className="size-9 shrink-0" onClick={add} aria-label={tr("pronunciation.addAria")}>
            <Plus className="size-4" />
          </Button>
        </Hint>
      </div>

      {/* search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tr("pronunciation.searchPlaceholder")}
          className="h-9 pl-8"
        />
      </div>

      {/* list: 2 columns on wide screens */}
      <div className="rounded-lg border border-border bg-card/20">
        {entries.length === 0 ? (
          <p className="px-3 py-4 text-[0.8rem] text-faint">
            {q.trim() ? tr("pronunciation.noMatch") : tr("pronunciation.empty")}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-x-6 p-1.5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {entries.map(([t, p]) => (
              <div
                key={t}
                className="group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/40"
              >
                <Hint text={t}>
                  <span className="w-[38%] shrink-0 cursor-help truncate font-mono text-[0.8rem] text-foreground">
                    {t}
                  </span>
                </Hint>
                <span className="shrink-0 text-faint/60" aria-hidden>→</span>
                <Hint text={tr("pronunciation.speaksAs", { p })}>
                  <span className="min-w-0 flex-1 cursor-help truncate text-[0.8rem] text-primary/90">
                    {p}
                  </span>
                </Hint>
                {/* actions on hover only, keeps the row clean */}
                <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <Hint text={tr("pronunciation.listenHint", { t })}>
                    <button
                      className="flex size-7 items-center justify-center rounded-md text-faint transition-colors hover:bg-accent hover:text-info focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60"
                      onClick={() => speak(p)}
                      aria-label={tr("pronunciation.testAria", { t })}
                    >
                      <Volume2 className="size-3.5" />
                    </button>
                  </Hint>
                  <Hint text={tr("pronunciation.removeHint", { t })}>
                    <button
                      className="flex size-7 items-center justify-center rounded-md text-faint transition-colors hover:bg-accent hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60"
                      onClick={() => remove(t)}
                      aria-label={tr("pronunciation.removeAria", { t })}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </Hint>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
