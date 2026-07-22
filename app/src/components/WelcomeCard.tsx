import { KeyRound, Volume2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { t } from "@/lib/i18n"
import type { Config } from "@/lib/api"

function ProviderDot({ label, ok, optional }: { label: string; ok: boolean; optional?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-1">
      <span className={cn("size-1.5 rounded-full", ok ? "bg-ok" : optional ? "bg-faint" : "bg-err")} />
      {label}
      {" • "}
      {ok ? t("app.providerOk") : optional ? t("app.providerOptional") : t("app.providerMissing")}
    </span>
  )
}

export function WelcomeCard({ config, onConfigure }: { config: Config | null; onConfigure: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center p-5">
      <Card className="w-full max-w-sm gap-0 p-6 text-center">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Volume2 className="size-6" />
        </div>
        <h2 className="text-sm font-bold tracking-wide text-foreground">{t("app.welcomeTitle")}</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {t("app.welcomeBody")}
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[0.7rem] text-muted-foreground">
          <ProviderDot label="Fish Audio" ok={!!config?.fishKeySet} />
          <ProviderDot label="OpenAI" ok={!!config?.openaiKeySet} optional />
        </div>
        <Button className="mt-5 w-full" onClick={onConfigure}>
          <KeyRound className="size-4" /> {t("app.configureKey")}
        </Button>
      </Card>
    </div>
  )
}
