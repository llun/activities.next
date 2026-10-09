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

export interface UserList {
  id: string
  title: string
}

export interface SidebarProps {
  variant?: 'responsive' | 'drawer'
  onNavigate?: () => void
  user?: User | null
  currentActor?: ActorInfo | null
  actors?: ActorInfo[]
  unreadCount?: number
  fitnessUrl?: string
  galleryUrl?: string
  isAdmin?: boolean
  lists?: UserList[]
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
  isDrawer?: boolean
}

const NavRowMenu = ({
  item,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onHide,
  inline = false,
  isDrawer = false
}: NavRowMenuProps) => {
  // Hiding takes this row out of the navigation, and this trigger with it, so
  // the menu's own restore would put focus on a detached node — which lands the
  // user on <body>. The sidebar focuses the row's new home instead; this gets
  // out of its way. Every other close keeps the default restore, which is right
  // because the trigger is still there: Escape, a click outside, or a move.
  const isHidingRef = useRef(false)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Customize ${item.label} navigation`}
          className={cn(
            'grid shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground',
            isDrawer
              ? 'h-11 w-11 opacity-100'
              : cn('h-7 w-7', hoverControlClassName),
            !inline &&
              (isDrawer
                ? 'absolute right-1 top-1/2 -translate-y-1/2'
                : 'absolute right-1.5 top-1/2 -translate-y-1/2')
          )}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-56"
        onCloseAutoFocus={(event) => {
          if (!isHidingRef.current) return
          isHidingRef.current = false
          event.preventDefault()
        }}
      >
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
          <DropdownMenuItem
            onSelect={() => {
              isHidingRef.current = true
              onHide()
            }}
          >
            <EyeOff className="h-4 w-4" />
            Hide from navigation
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function Sidebar({
  variant = 'responsive',
  onNavigate,
  user,
  currentActor,
  actors = [],
  unreadCount = 0,
  fitnessUrl,
  galleryUrl,
  isAdmin = false,
  lists = [],
  features
}: SidebarProps) {
  const isDrawer = variant === 'drawer'
  const pathname = usePathname()
  const { order, hidden, hideItem, showItem, move } = useNavPreferences()
  const { shown, more } = useMemo(
    () =>
      buildNavLayout({
        fitnessUrl,
        galleryUrl,
        isAdmin,
        features,
        prefs: { navOrder: order, navHidden: hidden }
      }),
    [features, fitnessUrl, galleryUrl, hidden, isAdmin, order]
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

  // Hiding a row and putting it back both unmount the control that did it: the
  // row moves between the navigation and the More group, taking the ⋯ menu or
  // the eye with it. A browser hands focus to the document body when a focused
  // element goes away, so without this a keyboard user tidying their sidebar
  // starts again from the top of the document after every item. Focus follows
  // the row to where the menu said it was going.
  const rowRefs = useRef(new Map<string, HTMLElement | null>())
  const registerRow = (key: string) => (node: HTMLElement | null) => {
    rowRefs.current.set(key, node)
  }
  // Candidate keys, best first: the More group is collapsed unless the user
  // opened it, so a row hidden into it is usually represented by its toggle.
  const focusAfterChangeRef = useRef<string[] | null>(null)
  useEffect(() => {
    const candidates = focusAfterChangeRef.current
    if (!candidates) return
    focusAfterChangeRef.current = null
    for (const key of candidates) {
      const node = rowRefs.current.get(key)
      if (node) {
        node.focus()
        return
      }
    }
  }, [shown, more])

  const hideRow = (id: NavItemId) => {
    focusAfterChangeRef.current = [`more:${id}`, 'more:toggle']
    hideItem(id)
  }

  const restoreRow = (id: NavItemId) => {
    focusAfterChangeRef.current = [`nav:${id}`]
    showItem(id)
  }

  const renderRowMenu = (item: NavItem, index: number, inline = false) => (
    <NavRowMenu
      item={item}
      inline={inline}
      isDrawer={isDrawer}
      canMoveUp={index > 0}
      canMoveDown={index < shown.length - 1}
      onMoveUp={() => move(item.id, -1, visibleIds)}
      onMoveDown={() => move(item.id, 1, visibleIds)}
      onHide={() => hideRow(item.id)}
    />
  )

  // The fixed sidebar clears the home indicator itself; inside the drawer the
  // panel already pads by the inset, so adding it here would double it.
  const accountRowClassName = cn(
    'border-t px-4 pt-4',
    isDrawer ? 'pb-4' : 'pb-[calc(env(safe-area-inset-bottom,0px)+1rem)]'
  )

  return (
    <TooltipProvider delayDuration={0}>
      {/* Full sidebar - Desktop / Drawer. h-dvh, not h-screen: iOS Safari's
          100vh is the height with its toolbars hidden, so while they show, the
          bottom of a 100vh rail (the account) sits behind them. */}
      <aside
        className={cn(
          isDrawer
            ? 'flex h-full w-full min-h-0 flex-col bg-background'
            : 'fixed left-0 top-0 z-40 h-dvh w-[280px] border-r bg-surface-chrome backdrop-blur hidden xl:flex flex-col'
        )}
      >
        {/* flex, not block: the Logo link is inline-flex, and as an inline
            box in a block wrapper it sits in a 38px line box instead of its own
            32px, pushing the whole nav 6px down. */}
        <div className={cn('flex p-6', isDrawer && 'pr-14')}>
          <Logo size="md" onNavigate={onNavigate} />
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
                          ? 'text-primary-text'
                          : 'text-muted-foreground'
                      )}
                    >
                      <Link
                        href={item.href}
                        onClick={onNavigate}
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
                          isDrawer && 'min-h-[44px]',
                          !isListsSectionActive &&
                            'hover:bg-muted hover:text-foreground'
                        )}
                      >
                        <item.icon
                          className={cn(
                            'h-5 w-5',
                            isListsSectionActive && 'text-primary'
                          )}
                        />
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
                        className={cn(
                          'mr-1 rounded-md p-1 hover:bg-muted hover:text-foreground',
                          isDrawer &&
                            'min-h-[44px] min-w-[44px] flex items-center justify-center'
                        )}
                      >
                        {isListsOpen ? (
                          <ChevronDown
                            className={cn(
                              'h-4 w-4',
                              isListsSectionActive && 'text-primary'
                            )}
                          />
                        ) : (
                          <ChevronRight
                            className={cn(
                              'h-4 w-4',
                              isListsSectionActive && 'text-primary'
                            )}
                          />
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
                                onClick={onNavigate}
                                aria-current={isListActive ? 'page' : undefined}
                                className={cn(
                                  'block truncate rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                                  isDrawer && 'min-h-[44px] flex items-center',
                                  isListActive
                                    ? 'bg-primary/10 text-primary-text'
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
                    onClick={onNavigate}
                    ref={registerRow(`nav:${item.id}`)}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors relative',
                      isDrawer ? 'min-h-[44px] pr-14' : 'pr-10',
                      isActive
                        ? 'bg-primary/10 text-primary-text'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    <item.icon
                      className={cn('h-5 w-5', isActive && 'text-primary')}
                    />
                    {item.label}
                    {isNotifications && unreadCount > 0 && (
                      <>
                        <NotificationBadge
                          count={unreadCount}
                          aria-hidden="true"
                          // The badge and the ⋯ share the right edge, so it
                          // steps aside while the row is hovered on desktop;
                          // in drawer mode it stays visible.
                          className={cn(
                            'static ml-1',
                            isDrawer
                              ? ''
                              : 'transition-opacity group-hover:opacity-0'
                          )}
                        />
                        <span className="sr-only"> ({unreadCount} unread)</span>
                      </>
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
                  ref={registerRow('more:toggle')}
                  onClick={() => setMoreOpen((open) => !open)}
                  aria-expanded={isMoreOpen}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-muted hover:text-foreground',
                    isDrawer && 'min-h-[44px]',
                    isMoreSectionActive && !isMoreOpen
                      ? 'text-primary-text'
                      : 'text-muted-foreground'
                  )}
                >
                  <MoreHorizontal
                    className={cn(
                      'h-5 w-5',
                      isMoreSectionActive && !isMoreOpen && 'text-primary'
                    )}
                  />
                  More
                  <span className="ml-auto inline-flex items-center gap-1.5 text-xs">
                    {more.length}
                    {isMoreOpen ? (
                      <ChevronUp
                        className={cn(
                          'h-4 w-4',
                          isMoreSectionActive && 'text-primary'
                        )}
                      />
                    ) : (
                      <ChevronDown
                        className={cn(
                          'h-4 w-4',
                          isMoreSectionActive && 'text-primary'
                        )}
                      />
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
                            onClick={onNavigate}
                            ref={registerRow(`more:${item.id}`)}
                            aria-current={isActive ? 'page' : undefined}
                            className={cn(
                              'flex items-center gap-3 rounded-lg py-1.5 pl-6 text-sm transition-colors',
                              isDrawer ? 'min-h-[44px] pr-14' : 'pr-10',
                              isActive
                                ? 'bg-primary/10 text-primary-text'
                                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                            )}
                          >
                            <item.icon
                              className={cn(
                                'h-[18px] w-[18px]',
                                isActive && 'text-primary'
                              )}
                            />
                            {item.label}
                          </Link>
                          <button
                            type="button"
                            aria-label={`Show ${item.label} in navigation`}
                            onClick={() => restoreRow(item.id)}
                            className={cn(
                              'absolute right-1.5 top-1/2 grid -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground',
                              isDrawer
                                ? 'h-11 w-11 opacity-100'
                                : cn('h-7 w-7', hoverControlClassName)
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
          <div className={accountRowClassName}>
            <ActorSwitcher
              currentActor={currentActor}
              actors={actors}
              onNavigate={onNavigate}
            />
          </div>
        ) : (
          user && (
            <div className={accountRowClassName}>
              <Link
                href={`/${user.handle}`}
                onClick={onNavigate}
                prefetch={false}
                className={cn(
                  'flex items-center gap-3 rounded-lg p-2 cursor-pointer hover:bg-muted transition-colors',
                  isDrawer && 'min-h-[44px]'
                )}
              >
                <Avatar className="h-10 w-10">
                  {user.avatarUrl && <AvatarImage src={user.avatarUrl} />}
                  <AvatarFallback className="bg-(--skeleton) font-semibold text-muted-foreground dark:bg-input">
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

      {/* Collapsed sidebar - Tablet. Same h-dvh reason as the full sidebar. */}
      {variant === 'responsive' && (
        <aside className="fixed left-0 top-0 z-40 h-dvh w-[72px] border-r bg-surface-chrome backdrop-blur hidden md:flex xl:hidden flex-col items-center">
          {/* flex for the same reason as the full sidebar's logo wrapper. The
              rail draws the logo at y 20 and its first item at y 64, so the
              extra 4px on top comes off the bottom (20 + 32 + 12 = 64). */}
          <div className="flex px-4 pt-5 pb-3">
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
                          ref={registerRow(`rail:${item.id}`)}
                          // The row is an icon, and the tooltip beside it only
                          // describes: without this the rail reads out as a list
                          // of unnamed links — including to whoever has just been
                          // handed one by restoring an item.
                          aria-label={item.label}
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
                                  isActive && 'text-primary-text'
                                )}
                              >
                                <item.icon
                                  className={cn(
                                    'h-4 w-4 shrink-0',
                                    isActive && 'text-primary'
                                  )}
                                />
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
                                // Radix moves focus to the next row for all but
                                // the last item, whose restore takes the flyout
                                // and this trigger with it — so that one hands
                                // focus to the rail button the item just became.
                                if (more.length === 1) {
                                  focusAfterChangeRef.current = [
                                    `rail:${item.id}`
                                  ]
                                }
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
            // The bottom padding clears the home indicator, so the account
            // stays tappable on iPhones and foldables in landscape.
            // w-full so the divider spans the whole rail (the aside is an
            // items-center column, which would shrink it to its content);
            // justify-center keeps the avatar where it was.
            <div className="flex w-full justify-center border-t px-3 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)]">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href={`/${user.handle}`}
                    prefetch={false}
                    className="cursor-pointer block"
                  >
                    <Avatar className="h-10 w-10">
                      {user.avatarUrl && <AvatarImage src={user.avatarUrl} />}
                      <AvatarFallback className="bg-(--skeleton) font-semibold text-muted-foreground dark:bg-input">
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
      )}
    </TooltipProvider>
  )
}
