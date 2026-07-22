import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import Widget from "./Widget"
import "./index.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider delayDuration={300}>
      <Widget />
      <Toaster position="bottom-center" theme="dark" richColors />
    </TooltipProvider>
  </StrictMode>,
)
