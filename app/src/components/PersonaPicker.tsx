import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getPersonas, postConfig, type Persona } from "@/lib/api"
import { t } from "@/lib/i18n"

export function PersonaPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [personas, setPersonas] = useState<Persona[]>([])
  useEffect(() => {
    getPersonas().then(setPersonas)
  }, [])

  async function select(v: string) {
    onChange(v)
    const r = await postConfig({ persona: v })
    const label = personas.find((p) => p.id === v)?.label ?? v
    if (r.ok) toast.success(t("settings.personaChanged", { label }))
    else toast.error(t("settings.personaChangeError"))
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="persona">{t("settings.persona")}</Label>
      <Select value={value} onValueChange={select}>
        <SelectTrigger id="persona" className="w-full">
          <SelectValue placeholder={t("settings.personaPlaceholder")} />
        </SelectTrigger>
        <SelectContent>
          {personas.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
