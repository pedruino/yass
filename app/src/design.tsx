import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { TooltipProvider } from "@/components/ui/tooltip"
import DesignShowcase from "./components/DesignShowcase"
import "./index.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <DesignShowcase />
    </TooltipProvider>
  </StrictMode>,
)
