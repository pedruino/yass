import { useEffect, useState } from "react"
import { Volume2, SpellCheck2, Terminal } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Hint } from "@/components/ui/hint"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PersonaPicker } from "./PersonaPicker"
import { VoicePicker } from "./VoicePicker"
import { Indicator } from "./indicators/Indicator"
import { INDICATORS, useIndicator, setIndicator } from "@/lib/indicators"
import {
  getClaudeIntegration,
  postConfig,
  setClaudeIntegration,
  speak,
  type ClaudeIntegration,
  type Config,
  type ConfigPatch,
} from "@/lib/api"
import { t } from "@/lib/i18n"
import type { View } from "./NavRail"

/** Inline settings view, replaces the old side Sheet. */
export function SettingsView({
  config,
  onChange,
  onNavigate,
}: {
  config: Config | null
  onChange: () => void
  onNavigate: (v: View) => void
}) {
  const [fish, setFish] = useState("")
  const [openai, setOpenai] = useState("")
  const [persona, setPersona] = useState("jarvis")
  const [voice, setVoice] = useState("")
  const [testing, setTesting] = useState(false)
  const [claude, setClaude] = useState<ClaudeIntegration | null>(null)
  const indicator = useIndicator()

  useEffect(() => {
    getClaudeIntegration().then(setClaude)
  }, [])

  function toggleClaude(enabled: boolean) {
    setClaude((c) => (c ? { ...c, enabled } : c))
    setClaudeIntegration(enabled)
      .then(setClaude)
      .then(() => toast.success(enabled ? t("settings.claudeOn") : t("settings.claudeOff")))
      .catch(() => {
        toast.error(t("settings.claudeError"))
        getClaudeIntegration().then(setClaude)
      })
  }

  // Sync local state when config changes: "derived state during render" pattern
  // (setState guarded in render, no effect).
  const [prevConfig, setPrevConfig] = useState<Config | null>(null)
  if (config && config !== prevConfig) {
    setPrevConfig(config)
    setPersona(config.persona)
    setVoice(config.fishVoiceId)
  }

  async function saveKeys() {
    const patch: ConfigPatch = {}
    if (fish.trim()) patch.fishApiKey = fish.trim()
    if (openai.trim()) patch.openaiApiKey = openai.trim()
    if (Object.keys(patch).length === 0) {
      toast(t("settings.nothingToSave"))
      return
    }
    const r = await postConfig(patch)
    if (r.ok) {
      toast.success(t("settings.keysSaved"))
      setFish("")
      setOpenai("")
      onChange()
    } else {
      toast.error(t("settings.keysSaveError"))
    }
  }

  function test() {
    if (testing) return
    setTesting(true)
    speak(t("settings.testPhrase"))
      .then((r) => (r.ok ? toast.success(t("settings.testPlaying")) : toast.error(t("settings.testError"))))
      .finally(() => setTesting(false))
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-1 duration-200">
      <div className="mx-auto w-full max-w-6xl space-y-4 px-6 py-4">
        <header>
          <h2 className="flex items-center gap-1.5 text-[0.95rem] font-bold tracking-wide text-foreground">
            <Volume2 className="size-4 text-primary" /> {t("settings.title")}
          </h2>
          <p className="mt-0.5 text-[0.75rem] text-muted-foreground">
            {t("settings.subtitle")}
          </p>
        </header>

        {/* Two columns: voice/persona (the tallest) in one column, appearance +
            pronunciation + keys in the other. Default window is 800px so md fires;
            collapses to 1 column if it shrinks below 768. */}
        <div className="grid items-start gap-4 md:grid-cols-2">
        {/* Voice and personality */}
        <section className="space-y-4 rounded-lg border border-border bg-card/40 p-4">
          <h3 className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-primary">
            {t("settings.voiceAndPersonality")}
          </h3>
          <PersonaPicker
            value={persona}
            onChange={(v) => {
              setPersona(v)
              onChange()
            }}
          />
          <Separator />
          <VoicePicker
            value={voice}
            defaultVoiceId={config?.defaultVoiceId ?? ""}
            onChange={(v) => {
              setVoice(v)
              onChange()
            }}
          />
        </section>

        {/* Column B: appearance + pronunciation + keys stacked */}
        <div className="space-y-4">
        {claude?.installed && (
          <section className="rounded-lg border border-border bg-card/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <h3 className="flex items-center gap-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-primary">
                  <Terminal className="size-3.5" /> {t("settings.claudeIntegration")}
                </h3>
                <p className="text-[0.7rem] text-faint">{t("settings.claudeIntegrationHint")}</p>
              </div>
              <Switch
                checked={claude.enabled}
                onCheckedChange={toggleClaude}
                aria-label={t("settings.claudeIntegration")}
              />
            </div>
          </section>
        )}
        {/* Appearance */}
        <section className="space-y-3 rounded-lg border border-border bg-card/40 p-4">
          <h3 className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-primary">
            {t("settings.appearance")}
          </h3>
          <div className="space-y-1.5">
            <Label htmlFor="indicator">{t("settings.indicatorStyle")}</Label>
            <div className="flex items-center gap-2">
              <Select value={indicator} onValueChange={setIndicator}>
                <SelectTrigger id="indicator" className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INDICATORS.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex h-9 w-12 shrink-0 items-center justify-center rounded-md border border-border bg-card">
                <Indicator styleId={indicator} />
              </div>
            </div>
            <p className="text-[0.7rem] text-faint">{t("settings.indicatorPreview")}</p>
          </div>
        </section>

        {/* Pronunciation */}
        <section className="rounded-lg border border-border bg-card/40 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="space-y-0.5">
              <h3 className="flex items-center gap-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-primary">
                <SpellCheck2 className="size-3.5" /> {t("settings.pronunciation")}
              </h3>
              <p className="text-[0.7rem] text-faint">{t("settings.pronunciationHint")}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => onNavigate("pronunciation")}>
              {t("settings.manage")}
            </Button>
          </div>
        </section>

        {/* Keys */}
        <section className="space-y-4 rounded-lg border border-border bg-card/40 p-4">
          <h3 className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-primary">
            {t("settings.apiKeys")}
          </h3>
          <div className="space-y-1.5">
            <Label htmlFor="fishkey">
              Fish Audio{" "}
              {config?.fishKeySet && <span className="text-[0.7rem] text-ok">{t("settings.defined")}</span>}
            </Label>
            <Input
              id="fishkey"
              type="password"
              autoComplete="off"
              value={fish}
              onChange={(e) => setFish(e.target.value)}
              placeholder={t("settings.fishPlaceholder")}
            />
            <p className="text-[0.7rem] text-faint">{t("settings.fishHint")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="openaikey">
              OpenAI{" "}
              {config?.openaiKeySet && <span className="text-[0.7rem] text-ok">{t("settings.defined")}</span>}{" "}
              <span className="text-[0.7rem] text-faint">{t("settings.openaiOptional")}</span>
            </Label>
            <Input
              id="openaikey"
              type="password"
              autoComplete="off"
              value={openai}
              onChange={(e) => setOpenai(e.target.value)}
              placeholder="sk-…"
            />
            <p className="text-[0.7rem] text-faint">{t("settings.openaiHint")}</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={saveKeys} className="flex-1">
              {t("settings.saveKeys")}
            </Button>
            <Hint text={t("settings.testHint")}>
              <Button variant="outline" onClick={test} disabled={testing}>
                <Volume2 className="size-4" /> {t("settings.testVoice")}
              </Button>
            </Hint>
          </div>
        </section>
        </div>
        </div>
      </div>
    </div>
  )
}
