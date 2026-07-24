'use client'

import { ChevronDown, type LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FC } from 'react'

import { Button } from '@/lib/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export interface SectionNavTab {
  name: string
  url: string
  icon: LucideIcon
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
 * as one flat run — the design system's sub-nav has no group headings or
 * separators, because every entry in a section's menu is already part of that
 * one section. The active item is marked `aria-current="page"`. See the "Page
 * Header & Sub-Navigation" section in AGENTS.md.
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
          {/* The design's trigger is taller and softer-cornered than the shared
              Button default (h-10 / rounded-lg, not h-9 / rounded-md). */}
          <Button
            variant="outline"
            className="h-10 w-full justify-between rounded-lg sm:w-64"
          >
            <span className="flex items-center gap-2">
              <activeTab.icon className="h-4 w-4 text-primary" />
              {activeTab.name}
            </span>
            {/* Muted, unlike the label — the chevron is chrome, not content. */}
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        {/* Rounder and lifted higher off the page than the shared menu default
            (rounded-xl / shadow-lg, not rounded-md / shadow-md).

            The width class MUST use Tailwind v4's parenthesis syntax for a bare
            CSS variable. The v3 bracket form, `w-[--radix-…]`, compiles to
            `width: --radix-…` rather than `width: var(--radix-…)` — an invalid
            declaration the browser drops silently, leaving the menu to size to
            its content instead of to the trigger. */}
        <DropdownMenuContent
          align="start"
          className="w-(--radix-dropdown-menu-trigger-width) rounded-xl shadow-lg"
        >
          {tabs.map((tab) => {
            const isActive = tab.url === activeTab.url
            return (
              <DropdownMenuItem
                key={tab.url}
                asChild
                // Every style lives in this one className so tailwind-merge
                // resolves it against the shared item defaults. Splitting the
                // active-state classes onto the child Link would leave the two
                // sets merely string-joined by Radix's Slot, and which `focus:`
                // background won would come down to Tailwind's emit order
                // rather than to the merge.
                className={cn(
                  // Roomier than the shared item default, which is sized for
                  // dense action menus: px-3 py-2 and gap-2.5, not px-2 py-1.5
                  // and gap-2. Every row is font-medium — the active one is
                  // distinguished by colour, not by weight.
                  'gap-2.5 rounded-lg px-3 py-2 font-medium',
                  isActive && [
                    // The design system's signature active state: a 10% orange
                    // wash plus orange text, held on focus too so hovering the
                    // current row doesn't drop it to the plain hover grey.
                    'bg-primary/10 text-primary focus:bg-primary/10 focus:text-primary',
                    // …but "held on focus" would otherwise make the focused
                    // current row pixel-identical to its resting state, so a
                    // keyboard user watching the highlight move down the list
                    // would see it vanish on exactly one row. The ring is what
                    // keeps focus visible there (WCAG 2.4.7); it fits inside
                    // the menu's p-1 without clipping.
                    'focus:ring-2 focus:ring-primary/50'
                  ]
                )}
              >
                <Link
                  href={tab.url}
                  aria-current={isActive ? 'page' : undefined}
                  className="flex w-full items-center"
                >
                  {/* Naming the colour outright does two jobs: it states the
                      intent, and the literal "text-" opts the icon out of the
                      shared rule that greys every un-coloured icon in a menu
                      item. A bare `text-current` would do the same but reads
                      as a no-op and invites deletion. */}
                  <tab.icon
                    className={cn(
                      'size-4',
                      isActive ? 'text-primary' : 'text-popover-foreground'
                    )}
                  />
                  {tab.name}
                </Link>
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  )
}
