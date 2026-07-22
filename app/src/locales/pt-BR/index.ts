import { app } from "./app"
import { speak } from "./speak"
import { settings } from "./settings"
import { pronunciation } from "./pronunciation"
import { stats } from "./stats"
import { common } from "./common"
import { design } from "./design"

// Active locale catalog. Each fragment owns one UI area and namespaces its keys
// (e.g. "speak.title") so fragments never collide when merged.
export const ptBR = {
  ...app,
  ...speak,
  ...settings,
  ...pronunciation,
  ...stats,
  ...common,
  ...design,
}
