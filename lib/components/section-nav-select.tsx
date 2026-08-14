'use client'

import { ChevronDown, type LucideIcon } from 'lucide-react'

import { Button } from '@/lib/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export interface SectionNavSelectTab<Id extends string> {
  id: Id
  label: string
  icon: LucideIcon
}

interface SectionNavSelectProps<Id extends string> {
  /** Accessible name for the `<nav>` landmark (e.g. "Activity sections"). */
  label: string
  tabs: SectionNavSelectTab<Id>[]
  active: Id
  onChange: (id: Id) => void
  /** Sizing for the `<nav>` wrapper. Defaults to the design's contained width. */
  className?: string
}

/**
 * The state-driven twin of `SectionNavDropdown`
 * (`@/lib/components/section-nav-dropdown`).
 *
 * Both render the design system's section sub-navigation chrome — an outline
 * trigger carrying the active tab's icon in `text-primary`, a sentence-case
 * label and a muted chevron, over a menu whose current row takes the signature
 * 10% orange wash. They differ only in what a row does: `SectionNavDropdown`
 * navigates (its tabs are `<Link>`s resolved from the pathname), while this one
 * switches a view held in local state, so its rows are menu items calling
 * `onChange` and the current one is marked with the boolean `aria-current`
 * rather than `aria-current="page"` — nothing here is a page.
 *
 * Keep the two in step: a copy of this chrome is exactly what the fitness
 * activity detail and the gear detail page would otherwise each carry.
 */
export const SectionNavSelect = <Id extends string>({
  label,
  tabs,
  active,
  onChange,
  className
}: SectionNavSelectProps<Id>) => {
  const activeTab = tabs.find((tab) => tab.id === active) ?? tabs[0]
  if (!activeTab) return null
  const ActiveIcon = activeTab.icon

  return (
    <nav
      aria-label={label}
      className={cn('w-full sm:max-w-[260px]', className)}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {/* The design's trigger is taller and softer-cornered than the shared
              Button default (h-10 / rounded-lg, not h-9 / rounded-md). */}
          <Button
            variant="outline"
            className="h-10 w-full justify-between rounded-lg"
          >
            <span className="flex items-center gap-2">
              <ActiveIcon className="size-4 text-primary" />
              {activeTab.label}
            </span>
            {/* Muted, unlike the label — the chevron is chrome, not content. */}
            <ChevronDown className="size-4 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        {/* Tailwind v4 parenthesis syntax — the v3 `w-[--radix-…]` form emits
            `width: --radix-…` instead of `width: var(--radix-…)`, which the
            browser drops silently, leaving the menu narrower than its trigger.
            Guarded by lib/components/tailwindCssVariableSyntax.test.ts. */}
        <DropdownMenuContent
          align="start"
          className="w-(--radix-dropdown-menu-trigger-width) rounded-xl shadow-lg"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = tab.id === activeTab.id
            return (
              <DropdownMenuItem
                key={tab.id}
                onSelect={() => onChange(tab.id)}
                // State-driven menu (nothing navigates), so the boolean form
                // rather than aria-current="page".
                aria-current={isActive ? 'true' : undefined}
                // Every style lives in this one className so tailwind-merge
                // resolves it against the shared item defaults.
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 font-medium',
                  isActive && [
                    // The design system's signature active state: a 10% orange
                    // wash plus orange text. `text-primary-text`, not
                    // `text-primary` — `--primary` is the icon/fill orange and
                    // is under the AA floor as a foreground.
                    'bg-primary/10 text-primary-text focus:bg-primary/10 focus:text-primary-text',
                    // "Held on focus" would otherwise make the focused current
                    // row pixel-identical to its resting state, so a keyboard
                    // user watching the highlight move down the list would see
                    // it vanish on exactly one row. The ring keeps focus
                    // visible there (WCAG 2.4.7).
                    'focus:ring-2 focus:ring-primary/50'
                  ]
                )}
              >
                {/* Naming the colour outright opts the icon out of the shared
                    rule that greys every un-coloured icon in a menu item. */}
                <Icon
                  className={cn(
                    'size-4',
                    isActive ? 'text-primary' : 'text-popover-foreground'
                  )}
                />
                {tab.label}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  )
}
