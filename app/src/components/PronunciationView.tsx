import { SpellCheck2 } from "lucide-react"
import { PronunciationEditor } from "./PronunciationEditor"
import { t } from "@/lib/i18n"

/** Inline pronunciation view. Replaces the former dialog inside the Sheet. */
export function PronunciationView() {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-1 duration-200">
      <div className="w-full space-y-4 px-6 py-4">
        <header>
          <h2 className="flex items-center gap-1.5 text-[0.95rem] font-bold tracking-wide text-foreground">
            <SpellCheck2 className="size-4 text-primary" /> {t("pronunciation.title")}
          </h2>
          <p className="mt-0.5 text-[0.75rem] text-muted-foreground">
            {t("pronunciation.subtitle")}
          </p>
        </header>
        <PronunciationEditor />
      </div>
    </div>
  )
}
