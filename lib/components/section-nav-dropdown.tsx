'use client'

import { ChevronDown, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FC, useId } from 'react'

import {
  SECTION_NAV_ICON_CLASS,
  type SectionNavFooter,
  type SectionNavGroup,
  type SectionNavItem,
  SectionNavItemBadge,
  orderSectionNavGroups
} from '@/lib/components/section-nav-shared'
import { resolveActiveSectionUrl } from '@/lib/components/sectionNavActive'
import { Button } from '@/lib/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

interface SectionNavDropdownProps {
  /** Accessible name for the <nav> landmark ("Settings", "Fitness", "Connections"). */
  label: string
  /** The list-page link's text below `md` when `label` is long ("Account"). */
  shortLabel?: string
  groups: SectionNavGroup[]
  footer?: SectionNavFooter
  /**
   * The section's list page. Given, the row starts with a link to it before
   * the trigger (Settings, Account & security, Admin). Fitness and Gallery
   * have no list page and render the trigger alone.
   */
  indexUrl?: string
}

// Every style lives in this one className so tailwind-merge resolves it
// against the shared item defaults. Splitting the active-state classes onto
// the child Link would leave the two sets merely string-joined by Radix's
// Slot, and which `focus:` background won would come down to Tailwind's emit
// order rather than to the merge.
//
// Roomier than the shared item default, which is sized for dense action
// menus: px-3 py-2 and gap-2.5, not px-2 py-1.5 and gap-2; 44px tall under a
// coarse pointer. Every row is font-medium — the active one is distinguished
// by colour, not by weight.
//
// The last class undoes the shared item's rule that greys every un-coloured
// svg (`[&_svg:not([class*='text-'])]:text-muted-foreground` in
// ui/dropdown-menu.tsx): items pass rendered icons with no class, so the icon
// takes the colour of its wrapper span instead. The variant text must match
// the primitive's character for character (quotes included) or tailwind-merge
// will not drop the shared class and both will be emitted.
const ROW_CLASS =
  "gap-2.5 rounded-lg px-3 py-2 font-medium pointer-coarse:min-h-11 [&_svg:not([class*='text-'])]:text-current"

// The design system's signature active state: a 10% orange wash plus orange
// text, held on focus too so hovering the current row doesn't drop it to the
// plain hover grey. The text takes `--primary-text`, not `--primary`: the
// latter is the icon/fill orange and sits under the AA floor as a foreground.
// Its state-driven twin `SectionNavSelect` paints the identical row, and the
// pair sits on one screen on a gear's page. The `dark:focus:` twin is what
// keeps the shared `dark:focus:bg-muted` from surviving tailwind-merge.
// "Held on focus" would otherwise make the focused current row
// pixel-identical to its resting state, so a keyboard user watching the
// highlight move down the list would see it vanish on exactly one row. The
// ring keeps focus visible there (WCAG 2.4.7); it fits inside the menu's p-1.
const ACTIVE_ROW_CLASS =
  'bg-primary/10 text-primary-text focus:bg-primary/10 focus:text-primary-text dark:focus:bg-primary/10 focus:ring-2 focus:ring-primary/50'

// What counts as the user taking over from the automatic reveal.
const STEERING_EVENTS = ['keydown', 'wheel', 'pointerdown'] as const
// The wheel listener only observes, so it is passive and never blocks scrolling.
const LISTENER_OPTIONS: Record<
  (typeof STEERING_EVENTS)[number],
  AddEventListenerOptions | undefined
> = {
  keydown: undefined,
  wheel: { passive: true },
  pointerdown: undefined
}

// Scroll the menu itself (never the window) just far enough to show `row`,
// with a few pixels of room for its focus ring.
const revealRow = (menu: HTMLElement, row: HTMLElement) => {
  const room = 4
  const menuRect = menu.getBoundingClientRect()
  const rowRect = row.getBoundingClientRect()
  if (rowRect.bottom + room > menuRect.bottom)
    menu.scrollTop += rowRect.bottom + room - menuRect.bottom
  else if (rowRect.top - room < menuRect.top)
    menu.scrollTop -= menuRect.top - (rowRect.top - room)
}

// Open on the current page. Radix would focus the first row (keyboard) or the
// panel (pointer), leaving the current row of a long menu below the fold; the
// current row takes focus instead, and the arrow keys continue from it.
// Because the handler calls `preventDefault`, Radix skips its own focus, so the
// roving-focus entry focus never fires and typeahead keeps working.
//
// The menu is not capped to the window yet when it takes focus: Radix measures
// the available height a moment later and only then sets
// `--radix-dropdown-menu-content-available-height`. So the row is revealed
// again whenever the menu changes size, and once more after the open animation
// (the menu's rects are scaled while it zooms in). jsdom has no layout, so
// there the reveal is a no-op.
//
// `DropdownMenu.Content` keeps `onOpenAutoFocus` off its public types (only
// the menu internals declare it) but passes every prop through to the menu's
// `FocusScope`, which is where the event comes from. It is therefore spread
// from a variable rather than written as a prop, and the component test
// "opens on the current page" fails if a Radix update stops honouring it.
const focusCurrentRowOnOpen = {
  onOpenAutoFocus: (event: Event) => {
    const menu = event.currentTarget as HTMLElement | null
    const current = menu?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!menu || !current) return
    event.preventDefault()
    current.focus({ preventScroll: true })
    revealRow(menu, current)

    const menuEl = menu
    const currentEl = current
    // The late reveals only help while the user has not moved: once focus has
    // left the current row, or they press a key, wheel or press inside the
    // menu, they are steering and the menu must not be pulled back.
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => reveal())
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = () => {
      observer?.disconnect()
      clearTimeout(timer)
      for (const type of STEERING_EVENTS)
        menu.removeEventListener(type, stop, LISTENER_OPTIONS[type])
    }
    function reveal() {
      // A timer or observer that fires after the menu (or, in tests, the whole
      // document) has gone away must be a no-op, not a crash.
      if (!menuEl.isConnected) return stop()
      if (menuEl.ownerDocument.activeElement !== currentEl) return stop()
      revealRow(menuEl, currentEl)
    }
    for (const type of STEERING_EVENTS)
      menu.addEventListener(type, stop, LISTENER_OPTIONS[type])
    observer?.observe(menu)
    timer = setTimeout(() => {
      reveal()
      stop()
    }, 300)
  }
}

/**
 * The section sub-navigation of every section (Settings, Account & security,
 * Admin, Fitness, Gallery, Fitness › Connections) at every width: an outline
 * trigger naming the current page over a menu of the section's pages, grouped
 * under small headings when the section groups them, with the cross-link and
 * the after-footer pages at its foot; before the trigger, a link to the
 * section's list page when it has one. There is no other section navigation:
 * never a list or rail beside the content. See "Page Header & Sub-Navigation"
 * in docs/architecture.md.
 */
export const SectionNavDropdown: FC<SectionNavDropdownProps> = ({
  label,
  shortLabel,
  groups,
  footer,
  indexUrl
}) => {
  const pathname = usePathname()
  const id = useId()
  const items = groups.flatMap((group) => group.items)
  if (items.length === 0) return null

  // Longest-prefix match over every url an item answers to, so a nested page
  // (a report, a domain, verify-email) names its parent.
  const candidates = items.flatMap((item) => [
    item.url,
    ...(item.alsoMatches ?? [])
  ])
  const activeUrl = resolveActiveSectionUrl(pathname, candidates)
  const activeItem = items.find(
    (item) =>
      item.url === activeUrl || item.alsoMatches?.includes(activeUrl ?? '')
  )
  const { before, after } = orderSectionNavGroups(groups)

  const row = (item: SectionNavItem) => {
    const isActive = item === activeItem
    return (
      <DropdownMenuItem
        key={item.url}
        asChild
        className={cn(ROW_CLASS, isActive && ACTIVE_ROW_CLASS)}
      >
        <Link
          href={item.url}
          aria-current={isActive ? 'page' : undefined}
          className="flex w-full items-center gap-2.5"
        >
          <span
            className={cn(
              SECTION_NAV_ICON_CLASS,
              isActive ? 'text-primary' : 'text-popover-foreground'
            )}
          >
            {item.icon}
          </span>
          <span className="min-w-0 flex-1 truncate">{item.name}</span>
          {/* The count beside the row, with its sr-only label. */}
          <SectionNavItemBadge count={item.badge} label={item.badgeLabel} />
        </Link>
      </DropdownMenuItem>
    )
  }

  // A headed group is set off by its label; a headless run after the first
  // block gets a separator; a headless run is a plain block, not an unnamed
  // group (the same rule as the index).
  const block = (
    group: SectionNavGroup,
    index: number,
    separatorBefore: boolean
  ) => {
    const headingId = `${id}-${index}`
    const rows = group.items.map(row)
    if (!group.heading) {
      return (
        <div key={group.items[0]?.url ?? index}>
          {separatorBefore && <DropdownMenuSeparator />}
          {rows}
        </div>
      )
    }
    return (
      <DropdownMenuGroup key={group.heading} aria-labelledby={headingId}>
        <DropdownMenuLabel
          id={headingId}
          className="px-3 pt-2 pb-0.5 text-xs font-medium text-muted-foreground"
        >
          {group.heading}
        </DropdownMenuLabel>
        {rows}
      </DropdownMenuGroup>
    )
  }

  const trigger = (
    <DropdownMenuTrigger asChild>
      {/* The design's trigger is taller and softer-cornered than the shared
          Button default (h-10 / rounded-lg, not h-9 / rounded-md). */}
      <Button
        variant="outline"
        className="h-10 w-full justify-between rounded-lg sm:w-64"
      >
        <span className="flex min-w-0 items-center gap-2">
          {activeItem && (
            <span className={cn(SECTION_NAV_ICON_CLASS, 'text-primary')}>
              {activeItem.icon}
            </span>
          )}
          <span className="truncate">
            {activeItem ? activeItem.name : label}
          </span>
        </span>
        {/* Muted, unlike the label — the chevron is chrome, not content. */}
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </Button>
    </DropdownMenuTrigger>
  )

  const menu = (
    <DropdownMenu>
      {trigger}
      {/* Rounder and lifted higher off the page than the shared menu default
          (rounded-xl / shadow-lg, not rounded-md / shadow-md). The width class
          MUST use Tailwind v4's parenthesis syntax for a bare CSS variable
          (lib/components/tailwindCssVariableSyntax.test.ts). The primitive
          caps the height to --radix-dropdown-menu-content-available-height and
          scrolls inside. `sideOffset={6}`: the Settings navigation board
          opens the menu 6 pt under the trigger. */}
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-(--radix-dropdown-menu-trigger-width) rounded-xl shadow-lg"
        {...focusCurrentRowOnOpen}
      >
        {before.map((group, index) => block(group, index, index > 0))}
        {/* The cross-link, then the after-footer pages, as plain rows behind
            a separator. The footer's url is not an active-page candidate: it
            points at another section. */}
        {footer && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className={ROW_CLASS}>
              <Link
                href={footer.item.url}
                className="flex w-full items-center gap-2.5"
              >
                <span className={cn(SECTION_NAV_ICON_CLASS, 'text-primary')}>
                  {footer.item.icon}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {footer.item.name}
                </span>
                <ChevronRight
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </Link>
            </DropdownMenuItem>
          </>
        )}
        {after.map((group, index) => block(group, before.length + index, true))}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  if (!indexUrl) {
    return (
      <nav aria-label={label} className="mb-4 max-md:mb-5">
        {menu}
      </nav>
    )
  }

  // The way back: a plain link to the section's list page, a slash, the
  // trigger: one row at every width. Not a breadcrumb landmark — the landmark
  // is this <nav>, and a menu button in a breadcrumb's "current" position
  // confuses screen readers. The link's accessible name is its visible text
  // plus a visually hidden suffix, not an `aria-label` that might not contain
  // the visible text (WCAG 2.5.3).
  return (
    <nav aria-label={label} className="mb-4 max-md:mb-5">
      <div className="flex min-w-0 items-center gap-2">
        <Link
          href={indexUrl}
          className="inline-flex min-h-10 shrink-0 items-center text-sm font-medium text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-foreground focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          {shortLabel ? (
            <>
              <span className="max-md:hidden">{label}</span>
              <span className="md:hidden">{shortLabel}</span>
            </>
          ) : (
            label
          )}
          <span className="sr-only"> (all pages)</span>
        </Link>
        <span
          aria-hidden="true"
          className="shrink-0 text-lg font-light text-muted-foreground"
        >
          /
        </span>
        <div className="min-w-0 flex-1 sm:flex-none">{menu}</div>
      </div>
    </nav>
  )
}
