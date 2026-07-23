'use client'

import { ChevronDown, type LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FC, Fragment } from 'react'

import { Button } from '@/lib/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export interface SectionNavTab {
  name: string
  url: string
  icon: LucideIcon
  // Optional heading a run of tabs sits under. Contiguous tabs sharing a group
  // render below a separator + label (e.g. admin's "Settings" group); tabs
  // without a group render as a plain list, exactly as before.
  group?: string
}

interface SectionNavDropdownProps {
  // Accessible name for the <nav> landmark (e.g. "Settings", "Fitness").
  label: string
  tabs: SectionNavTab[]
}

/**
 * Dropdown sub-navigation used by settings-style section layouts (settings,
 * fitness, admin) on every breakpoint, including desktop — the design-system default
 * that replaced the desktop vertical nav rail so the content spans the full
 * width. The trigger reflects the active section; the menu lists every section
 * with the active one marked `aria-current="page"`. See the "Page Header &
 * Sub-Navigation" section in AGENTS.md.
 */
export const SectionNavDropdown: FC<SectionNavDropdownProps> = ({
  label,
  tabs
}) => {
  const pathname = usePathname()

  // Pick the most-specific matching tab: filter to tabs whose url is the path
  // or a parent of it, then take the longest url so e.g.
  // `/account/security/...` resolves to Security, not General.
  const activeTab =
    tabs
      .filter(
        (tab) => pathname === tab.url || pathname.startsWith(`${tab.url}/`)
      )
      .sort((a, b) => b.url.length - a.url.length)[0] || tabs[0]

  return (
    <nav aria-label={label} className="mb-4">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="w-full justify-between sm:w-64">
            <span className="flex items-center gap-2">
              <activeTab.icon className="h-4 w-4 text-primary" />
              {activeTab.name}
            </span>
            <ChevronDown className="ml-2 h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-[--radix-dropdown-menu-trigger-width]"
        >
          {tabs.map((tab, index) => {
            const isActive = tab.url === activeTab.url
            // Start a labelled group when this tab begins a new run under a
            // group heading (the previous tab had a different or no group).
            const startsGroup =
              tab.group !== undefined && tab.group !== tabs[index - 1]?.group
            return (
              <Fragment key={tab.url}>
                {startsGroup && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {tab.group}
                    </DropdownMenuLabel>
                  </>
                )}
                <DropdownMenuItem asChild>
                  <Link
                    href={tab.url}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'flex w-full items-center gap-2',
                      // The design system's signature active state: a 10% orange
                      // wash plus orange text. The wash is a non-color-dependent
                      // cue alongside aria-current, so the state doesn't rely on
                      // the orange text alone.
                      isActive && 'bg-primary/10 font-medium text-primary'
                    )}
                  >
                    <tab.icon className="h-4 w-4" />
                    {tab.name}
                  </Link>
                </DropdownMenuItem>
              </Fragment>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  )
}
