import { Volume2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { StatusBadge } from "./StatusBadge"
import { t } from "@/lib/i18n"

const COLORS = [
  { name: "background", hex: "#0c0c0c", note: t("design.color.background") },
  { name: "card", hex: "#111111", note: t("design.color.card") },
  { name: "primary", hex: "#c77dff", note: t("design.color.primary") },
  { name: "foreground", hex: "#e4e4e4", note: t("design.color.foreground") },
  { name: "muted-foreground", hex: "#9a9a9a", note: t("design.color.mutedForeground") },
  { name: "faint", hex: "#7d7d7d", note: t("design.color.faint") },
  { name: "ok", hex: "#5cc46a", note: t("design.color.ok") },
  { name: "warn", hex: "#e6b800", note: t("design.color.warn") },
  { name: "err", hex: "#ff6b6b", note: t("design.color.err") },
  { name: "info", hex: "#6bb6ff", note: t("design.color.info") },
]

const TYPE = [
  { cls: "text-2xl font-bold", label: "2xl / bold" },
  { cls: "text-lg font-semibold", label: "lg / semibold" },
  { cls: "text-sm", label: "sm / regular" },
  { cls: "text-xs text-muted-foreground", label: "xs / muted" },
  { cls: "text-[10px] text-faint", label: "10px / faint" },
]

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-xs font-bold tracking-[0.18em] text-primary uppercase">{title}</h2>
      {children}
    </section>
  )
}

export default function DesignShowcase() {
  return (
    <div className="mx-auto max-w-3xl space-y-12 px-6 py-10 font-mono">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-primary">
          <Volume2 className="size-6" /> {t("design.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("design.subtitle")}
        </p>
      </header>

      <Section title={t("design.section.colors")}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {COLORS.map((c) => (
            <div key={c.name} className="overflow-hidden rounded-lg border border-border">
              <div className="h-14 w-full" style={{ background: c.hex }} />
              <div className="space-y-0.5 p-2">
                <div className="text-xs font-semibold">{c.name}</div>
                <div className="text-[10px] text-muted-foreground">{c.hex}</div>
                <div className="text-[10px] text-faint">{c.note}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title={t("design.section.typography")}>
        <div className="space-y-3 rounded-lg border border-border p-4">
          {TYPE.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-4">
              <span className={row.cls}>{t("design.type.sample")}</span>
              <span className="shrink-0 text-[10px] text-faint">{row.label}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title={t("design.section.spacing")}>
        <div className="flex flex-wrap items-end gap-4">
          {[1, 2, 3, 4, 6, 8].map((n) => (
            <div key={n} className="space-y-1 text-center">
              <div className="bg-primary/30" style={{ width: n * 4, height: n * 4 }} />
              <div className="text-[10px] text-faint">{n * 4}px</div>
            </div>
          ))}
          <div className="ml-4 flex items-end gap-3">
            {[
              { r: "sm", cls: "rounded-sm" },
              { r: "md", cls: "rounded-md" },
              { r: "lg", cls: "rounded-lg" },
              { r: "xl", cls: "rounded-xl" },
            ].map(({ r, cls }) => (
              <div key={r} className="space-y-1 text-center">
                <div className={`size-10 border border-border bg-card ${cls}`} />
                <div className="text-[10px] text-faint">{r}</div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section title={t("design.section.buttons")}>
        <div className="flex flex-wrap gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button size="sm">Small</Button>
        </div>
      </Section>

      <Section title={t("design.section.form")}>
        <div className="grid max-w-sm gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="d-in">Input</Label>
            <Input id="d-in" placeholder="placeholder…" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="d-sel">Select</Label>
            <Select>
              <SelectTrigger id="d-sel">
                <SelectValue placeholder={t("design.select.placeholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="a">Jarvis</SelectItem>
                <SelectItem value="b">Pumba</SelectItem>
                <SelectItem value="c">Narrador</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Section>

      <Section title={t("design.section.badges")}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>default</Badge>
          <Badge variant="secondary">secondary</Badge>
          <Badge variant="outline">outline</Badge>
          <StatusBadge status="queued" />
          <StatusBadge status="playing" />
          <StatusBadge status="done" />
          <StatusBadge status="error" />
        </div>
      </Section>

      <Section title={t("design.section.queueCard")}>
        <Card className="max-w-md p-0">
          <div className="flex gap-2 px-3 py-2">
            <span className="mt-1 size-2 shrink-0 rounded-full bg-primary" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span>meu-projeto</span>
                <span className="text-faint">/</span>
                <span>build</span>
                <span className="ml-auto text-faint">agora</span>
              </div>
              <p className="mt-0.5 text-[11px]">{t("design.card.sample")}</p>
            </div>
            <StatusBadge status="done" />
          </div>
        </Card>
      </Section>
    </div>
  )
}
