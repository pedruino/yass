import { ptBR } from "@/locales/pt-BR"

// Minimal i18n for UI labels. Keys are English identifiers; values live in the
// locale catalog. Single active locale (pt-BR) today, structured so more can be
// added later. Non-UI text (code comments, docs) is English and never routed here.
export type Locale = "pt-BR"
export type Catalog = Record<string, string>

const catalogs: Record<Locale, Catalog> = { "pt-BR": ptBR }
let locale: Locale = "pt-BR"

export function setLocale(next: Locale) {
  locale = next
}

// Look up a label by key. Interpolates {name} placeholders from `vars`.
// Falls back to `fallback`, then to the key itself, so a missing key is visible.
export function t(key: string, vars?: Record<string, string | number>, fallback?: string): string {
  let s = catalogs[locale][key] ?? fallback ?? key
  if (vars) for (const k in vars) s = s.replaceAll(`{${k}}`, String(vars[k]))
  return s
}
