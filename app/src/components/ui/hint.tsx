import * as React from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/**
 * Design system default tooltip. Every interactive or informative element uses
 * Hint, never the native `title` (inconsistent, slow, unthemed).
 *
 *   <Hint text="Silenciar"><Button …/></Hint>
 */
export function Hint({
  text,
  side = "top",
  children,
}: {
  text: React.ReactNode
  side?: "top" | "right" | "bottom" | "left"
  children: React.ReactElement
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} className="max-w-[240px] text-[0.8rem] leading-snug">
        {text}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Defined term: dotted underline + help cursor, tooltip explains the concept on
 * hover (glossary pattern).
 *
 *   <HintTerm text="Falas aguardando para tocar">2</HintTerm>
 */
export function HintTerm({
  text,
  className,
  children,
}: {
  text: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            "cursor-help border-b border-dotted border-current/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60",
            className,
          )}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[240px] text-[0.8rem] leading-snug">{text}</TooltipContent>
    </Tooltip>
  )
}
