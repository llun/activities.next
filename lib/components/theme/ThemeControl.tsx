'use client'

import { type LucideIcon, Monitor, Moon, Sun } from 'lucide-react'
import { FC } from 'react'

import { cn } from '@/lib/utils'

import { useTheme } from './ThemeProvider'
import { type ThemeMode } from './theme-core'

const OPTIONS: { mode: ThemeMode; label: string; Icon: LucideIcon }[] = [
  { mode: 'light', label: 'Light', Icon: Sun },
  { mode: 'dark', label: 'Dark', Icon: Moon },
  // System is last so the two explicit modes stay adjacent.
  { mode: 'system', label: 'System', Icon: Monitor }
]

interface ThemeControlProps {
  // `full` is the labeled segmented control for Settings → Appearance; `compact`
  // is the icon-only pill for tight chrome (sidebar footer, mobile More sheet).
  variant?: 'full' | 'compact'
  className?: string
}

export const ThemeControl: FC<ThemeControlProps> = ({
  variant = 'full',
  className
}) => {
  const { theme, setTheme, mounted } = useTheme()
  const compact = variant === 'compact'

  return (
    <div
      role="group"
      aria-label="Theme"
      className={cn(
        compact
          ? 'inline-flex gap-0.5 rounded-full border bg-card p-0.5 shadow-sm'
          : 'flex w-full gap-1 rounded-[10px] bg-muted p-1 sm:inline-flex sm:w-auto',
        className
      )}
    >
      {OPTIONS.map(({ mode, label, Icon }) => {
        // Gate the active highlight on `mounted`: the server can't know the
        // per-device stored mode, so rendering it before hydration would
        // mismatch. The visible page theme is already correct via the inline
        // init script regardless.
        const active = mounted && theme === mode
        return (
          <button
            key={mode}
            type="button"
            aria-pressed={active}
            aria-label={compact ? `${label} theme` : undefined}
            title={compact ? label : undefined}
            onClick={() => setTheme(mode)}
            className={cn(
              'inline-flex items-center justify-center gap-2 font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              compact
                ? 'size-7 rounded-full'
                : 'h-11 flex-1 rounded-[7px] text-sm sm:h-9 sm:flex-none sm:px-3.5',
              active
                ? compact
                  ? 'bg-primary/10 text-primary'
                  : 'bg-control-active text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="size-4" aria-hidden />
            {!compact && <span>{label}</span>}
          </button>
        )
      })}
    </div>
  )
}
