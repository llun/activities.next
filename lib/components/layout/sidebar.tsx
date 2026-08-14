'use client'

import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Eye,
  EyeOff,
  Lock,
  MoreHorizontal
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  ActorInfo,
  ActorSwitcher
} from '@/lib/components/actor-switcher/ActorSwitcher'
import { Logo } from '@/lib/components/layout/logo'
import { type NavItem, buildNavLayout } from '@/lib/components/layout/nav-items'
import { useNavPreferences } from '@/lib/components/layout/nav-preferences-context'
import { NotificationBadge } from '@/lib/components/notification-badge/NotificationBadge'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/lib/components/ui/tooltip'
import {
  type NavFeatureFlags,
  type NavItemId
} from '@/lib/services/navigation/navPreferences'
import { cn } from '@/lib/utils'

interface User {
  name: string
  username: string
  handle: string
  avatarUrl?: string
}

export interface SidebarList {
  id: string
  title: string
}

interface SidebarProps {
  user?: User
  currentActor?: ActorInfo
  actors?: ActorInfo[]
  unreadCount?: number
  fitnessUrl?: string
  isAdmin?: boolean
  lists?: SidebarList[]
  features?: Partial<NavFeatureFlags>
}

// A pointer that cannot hover never fires the reveal below, which would leave
// these controls invisible but still tappable — a blank gap that silently does
// something when touched. The collapsed rail lives at tablet widths, so that is
// not a hypothetical device.
const touchAlwaysVisibleClassName = '[@media(hover:none)]:opacity-100'

// The hover affordance shared by every customization control in the sidebar:
// invisible until the row is hovered or the control takes focus, and pinned
// visible while its own menu is open so the anchor doesn't fade underneath it.
const hoverControlClassName = cn(
  'opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100',
  touchAlwaysVisibleClassName
)

interface NavRowMenuProps {
  item: NavItem
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onHide: () => void
  // The Lists row lays its controls out in flow next to the collapse chevron;
  // every other row has no such neighbour and pins the trigger to the right.
  inline?: boolean
}

const NavRowMenu = ({
  item,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onHide,
  inline = false
}: NavRowMenuProps) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        aria-label={`Customize ${item.label} navigation`}
        className={cn(
          'grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground',
          hoverControlClassName,
          !inline && 'absolute right-1.5 top-1/2 -translate-y-1/2'
        )}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="w-56">
      <DropdownMenuItem disabled={!canMoveUp} onSelect={onMoveUp}>
        <ChevronUp className="h-4 w-4" />
        Move up
      </DropdownMenuItem>
      <DropdownMenuItem disabled={!canMoveDown} onSelect={onMoveDown}>
        <ChevronDown className="h-4 w-4" />
        Move down
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      {item.locked ? (
        <DropdownMenuItem disabled>
          <Lock className="h-4 w-4" />
          Always shown
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem onSelect={onHide}>
          <EyeOff className="h-4 w-4" />
          Hide from navigation
        </DropdownMenuItem>
      )}
    </DropdownMenuContent>
  </DropdownMenu>
)

export function Sidebar({
  user,
  currentActor,
  actors = [],
  unreadCount = 0,
  fitnessUrl,
  isAdmin = false,
  lists = [],
  features
}: SidebarProps) {
  const pathname = usePathname()
  const { order, hidden, hideItem, showItem, move } = useNavPreferences()
  const { shown, more } = useMemo(
    () =>
      buildNavLayout({
        fitnessUrl,
        isAdmin,
        features,
        prefs: { navOrder: order, navHidden: hidden }
      }),
    [features, fitnessUrl, hidden, isAdmin, order]
  )
  // Reordering swaps with the nearest neighbour that is actually on screen, so
  // hidden and unavailable items keep their slot.
  const visibleIds = useMemo(
    () => new Set<NavItemId>(shown.map((item) => item.id)),
    [shown]
  )

  const isItemActive = (href: string) =>
    pathname === href || pathname.startsWith(href + '/')

  const isListsSectionActive =
    pathname === '/lists' || pathname.startsWith('/lists/')
  // Default the Lists group open whenever the user is inside it so the active
  // list is visible without an extra click; otherwise start collapsed.
  const [isListsOpen, setListsOpen] = useState(isListsSectionActive)

  // Client-side navigation keeps the sidebar mounted, so the initial state
  // above doesn't re-run. Re-open the group whenever the route enters the Lists
  // section (the user can still collapse it manually afterwards).
  useEffect(() => {
    if (isListsSectionActive) setListsOpen(true)
  }, [isListsSectionActive])

  const isMoreSectionActive = more.some((item) => isItemActive(item.href))
  const [isMoreOpen, setMoreOpen] = useState(isMoreSectionActive)
  useEffect(() => {
    if (isMoreSectionActive) setMoreOpen(true)
  }, [isMoreSectionActive])

  const getAvatarInitial = (username: string) => {
    if (!username) return '?'
    return username[0].toUpperCase()
  }

  // Restoring an item unmounts the button that restored it — the row leaves the
  // More group — and a browser hands focus back to the document body when that
  // happens, so a keyboard user restoring three items would start again from
  // the top of the page each time. Focus follows the item to its place in the
  // navigation instead, which is also where the eye said it was going.
  const shownRowRefs = useRef(new Map<NavItemId, HTMLAnchorElement | null>())
  const restoredIdRef = useRef<NavItemId | null>(null)
  useEffect(() => {
    const restoredId = restoredIdRef.current
    if (!restoredId) return
    restoredIdRef.current = null
    shownRowRefs.current.get(restoredId)?.focus()
  }, [shown])

  const restoreItem = (id: NavItemId) => {
    restoredIdRef.current = id
    showItem(id)
  }

  const renderRowMenu = (item: NavItem, index: number, inline = false) => (
    <NavRowMenu
      item={item}
      inline={inline}
      canMoveUp={index > 0}
      canMoveDown={index < shown.length - 1}
      onMoveUp={() => move(item.id, -1, visibleIds)}
      onMoveDown={() => move(item.id, 1, visibleIds)}
      onHide={() => hideItem(item.id)}
    />
  )

  return (
    <TooltipProvider delayDuration={0}>
      {/* Full sidebar - Desktop */}
      <aside className="fixed left-0 top-0 z-40 h-screen w-[280px] border-r bg-background/90 backdrop-blur hidden xl:flex flex-col">
        <div className="p-6">
          <Logo size="md" />
        </div>

        {/* min-h-0 + overflow lets the nav scroll when a long Lists group (or
            many nav items) would otherwise push the account switcher footer
            below the fixed, full-height sidebar. */}
        <nav className="min-h-0 flex-1 overflow-y-auto px-3 pt-1">
          <ul className="space-y-1">
            {shown.map((item, index) => {
              const isActive = isItemActive(item.href)
              const isNotifications = item.id === 'notifications'

              // The Lists entry expands into the user's lists when they have
              // any; otherwise it stays a plain link to the (empty) index.
              if (item.id === 'lists' && lists.length > 0) {
                return (
                  <li key={item.id}>
                    <div
                      className={cn(
                        'group flex items-center rounded-lg text-sm font-medium transition-colors',
                        isListsSectionActive
                          ? 'text-primary'
                          : 'text-muted-foreground'
                      )}
                    >
                      <Link
                        href={item.href}
                        // Exactly one link in a navigation may claim the current
                        // page: inside one of the lists below, that link is the
                        // claimant; anywhere else in the section — the index,
                        // the new-list form, a list's edit page — this row is.
                        aria-current={
                          isListsSectionActive &&
                          !lists.some(
                            (list) => pathname === `/lists/${list.id}`
                          )
                            ? 'page'
                            : undefined
                        }
                        className={cn(
                          'flex flex-1 items-center gap-3 rounded-lg px-3 py-2 transition-colors',
                          !isListsSectionActive &&
                            'hover:bg-muted hover:text-foreground'
                        )}
                      >
                        <item.icon className="h-5 w-5" />
                        {item.label}
                      </Link>
                      {renderRowMenu(item, index, true)}
                      <button
                        type="button"
                        aria-label={
                          isListsOpen ? 'Collapse lists' : 'Expand lists'
                        }
                        aria-expanded={isListsOpen}
                        onClick={() => setListsOpen((open) => !open)}
                        className="mr-1 rounded-md p-1 hover:bg-muted hover:text-foreground"
                      >
                        {isListsOpen ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    {isListsOpen && (
                      <ul className="mt-1 space-y-1 pl-7">
                        {lists.map((list) => {
                          const isListActive = pathname === `/lists/${list.id}`
                          return (
                            <li key={list.id}>
                              <Link
                                href={`/lists/${list.id}`}
                                aria-current={isListActive ? 'page' : undefined}
                                className={cn(
                                  'block truncate rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                                  isListActive
                                    ? 'bg-primary/10 text-primary'
                                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                                )}
                              >
                                {list.title}
                              </Link>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </li>
                )
              }

              return (
                <li key={item.id} className="group relative">
                  <Link
                    href={item.href}
                    ref={(node) => {
                      shownRowRefs.current.set(item.id, node)
                    }}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 pr-10 text-sm font-medium transition-colors relative',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    <item.icon className="h-5 w-5" />
                    {item.label}
                    {isNotifications && unreadCount > 0 && (
                      <NotificationBadge
                        count={unreadCount}
                        // The badge and the ⋯ share the right edge, so it
                        // steps aside while the row is hovered.
                        className="static ml-1 transition-opacity group-hover:opacity-0"
                      />
                    )}
                  </Link>
                  {renderRowMenu(item, index)}
                </li>
              )
            })}

            {/* Items the user hid stay one click away rather than gone. The
                group is absent entirely when nothing is hidden, so an
                uncustomized sidebar looks exactly like it always has. */}
            {more.length > 0 && (
              <li className="pt-1">
                <button
                  type="button"
                  onClick={() => setMoreOpen((open) => !open)}
                  aria-expanded={isMoreOpen}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-muted hover:text-foreground',
                    isMoreSectionActive && !isMoreOpen
                      ? 'text-primary'
                      : 'text-muted-foreground'
                  )}
                >
                  <MoreHorizontal className="h-5 w-5" />
                  More
                  <span className="ml-auto inline-flex items-center gap-1.5 text-xs">
                    {more.length}
                    {isMoreOpen ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </span>
                </button>
                {isMoreOpen && (
                  <ul className="mt-1 space-y-1">
                    {more.map((item) => {
                      const isActive = isItemActive(item.href)
                      return (
                        <li key={item.id} className="group relative">
                          <Link
                            href={item.href}
                            aria-current={isActive ? 'page' : undefined}
                            className={cn(
                              'flex items-center gap-3 rounded-lg py-1.5 pl-6 pr-10 text-sm transition-colors',
                              isActive
                                ? 'bg-primary/10 text-primary'
                                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                            )}
                          >
                            <item.icon className="h-[18px] w-[18px]" />
                            {item.label}
                          </Link>
                          <button
                            type="button"
                            aria-label={`Show ${item.label} in navigation`}
                            onClick={() => restoreItem(item.id)}
                            className={cn(
                              'absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground',
                              hoverControlClassName
                            )}
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            )}
          </ul>
        </nav>

        {currentActor && actors.length > 0 ? (
          <div className="border-t p-4">
            <ActorSwitcher currentActor={currentActor} actors={actors} />
          </div>
        ) : (
          user && (
            <div className="border-t p-4">
              <Link
                href={`/${user.handle}`}
                className="flex items-center gap-3 rounded-lg p-2 cursor-pointer hover:bg-muted transition-colors"
              >
                <Avatar className="h-10 w-10">
                  {user.avatarUrl && <AvatarImage src={user.avatarUrl} />}
                  <AvatarFallback className="bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                    {getAvatarInitial(user.username)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 overflow-hidden">
                  <p className="text-sm font-medium truncate">{user.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {user.handle}
                  </p>
                </div>
              </Link>
            </div>
          )
        )}
      </aside>

      {/* Collapsed sidebar - Tablet */}
      <aside className="fixed left-0 top-0 z-40 h-screen w-[72px] border-r bg-background/90 backdrop-blur hidden md:flex xl:hidden flex-col items-center">
        <div className="p-4">
          <Logo showText={false} size="md" />
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto pb-4">
          <ul className="space-y-2">
            {shown.map((item) => {
              const isActive = isItemActive(item.href)
              const isNotifications = item.id === 'notifications'
              return (
                <li key={item.id}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Link
                        href={item.href}
                        aria-current={isActive ? 'page' : undefined}
                        className={cn(
                          'flex items-center justify-center rounded-lg p-3 transition-colors relative',
                          isActive
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        )}
                      >
                        <item.icon className="h-6 w-6" />
                        {isNotifications && unreadCount > 0 && (
                          <NotificationBadge
                            count={unreadCount}
                            className="absolute -top-1 -right-1"
                          />
                        )}
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                </li>
              )
            })}

            {more.length > 0 && (
              <li>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="More navigation"
                      className={cn(
                        'flex w-full items-center justify-center rounded-lg p-3 transition-colors',
                        isMoreSectionActive
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      )}
                    >
                      <MoreHorizontal className="h-6 w-6" />
                    </button>
                  </DropdownMenuTrigger>
                  {/* Every row is a pair of real menu items — open it, or put
                      it back. Radix swallows Tab inside its menu and only moves
                      focus between registered items, so anything else here (a
                      plain link, a button inside a row) is unreachable from the
                      keyboard. The restore item is hidden until its row is
                      hovered or focused, exactly like the sidebar's. */}
                  <DropdownMenuContent
                    side="right"
                    align="start"
                    className="w-56"
                  >
                    {more.map((item) => {
                      const isActive = isItemActive(item.href)
                      return (
                        <div key={item.id} className="group">
                          <DropdownMenuItem asChild>
                            <Link
                              href={item.href}
                              aria-current={isActive ? 'page' : undefined}
                              className={cn(
                                'flex items-center gap-2.5',
                                isActive && 'text-primary'
                              )}
                            >
                              <item.icon className="h-4 w-4 shrink-0" />
                              {item.label}
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            // Named per row: arrowing through the flyout
                            // otherwise announces the same bare command once
                            // per hidden item, with nothing tying it to a row.
                            aria-label={`Show ${item.label} in navigation`}
                            onSelect={(event) => {
                              // Keep the flyout open so several items can be
                              // restored in one visit.
                              event.preventDefault()
                              showItem(item.id)
                            }}
                            className={cn(
                              'gap-2.5 pl-8 text-xs text-muted-foreground',
                              // Radix marks the keyboard-focused item with
                              // data-highlighted rather than :focus-visible, so
                              // arrowing onto it is what reveals it.
                              'opacity-0 transition-opacity group-hover:opacity-100 data-[highlighted]:opacity-100',
                              touchAlwaysVisibleClassName
                            )}
                          >
                            <Eye className="h-4 w-4 shrink-0" />
                            Show in navigation
                          </DropdownMenuItem>
                        </div>
                      )
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            )}
          </ul>
        </nav>

        {user && (
          <div className="border-t p-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <Link href={`/${user.handle}`} className="cursor-pointer block">
                  <Avatar className="h-10 w-10">
                    {user.avatarUrl && <AvatarImage src={user.avatarUrl} />}
                    <AvatarFallback className="bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                      {getAvatarInitial(user.username)}
                    </AvatarFallback>
                  </Avatar>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">{user.handle}</TooltipContent>
            </Tooltip>
          </div>
        )}
      </aside>
    </TooltipProvider>
  )
}
