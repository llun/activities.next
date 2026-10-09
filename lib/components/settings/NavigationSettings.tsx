'use client'

import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  History,
  Lock,
  PanelLeft
} from 'lucide-react'
import { FC, useEffect, useMemo, useRef, useState } from 'react'

import {
  type BuildNavItemsParams,
  availableNavIds,
  getNavItem
} from '@/lib/components/layout/nav-items'
import { useNavPreferences } from '@/lib/components/layout/nav-preferences-context'
import { PageHeader } from '@/lib/components/page-header'
import { Alert } from '@/lib/components/surface/Alert'
import {
  FRAMED_LIST_ITEM_CLASS,
  FramedList
} from '@/lib/components/surface/FramedList'
import { SavedIndicator } from '@/lib/components/surface/SaveBar'
import { Section } from '@/lib/components/surface/Section'
import { Button } from '@/lib/components/ui/button'
import { Switch } from '@/lib/components/ui/switch'
import {
  type NavFeatureFlags,
  type NavItemId
} from '@/lib/services/navigation/navPreferences'
import { cn } from '@/lib/utils'

interface Props {
  fitnessUrl?: string
  galleryUrl?: string
  isAdmin?: boolean
  features?: Partial<NavFeatureFlags>
}

const Chip: FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
    {children}
  </span>
)

const StatusCaption: FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
    <Lock className="h-3.5 w-3.5" />
    {children}
  </span>
)

export const NavigationSettings: FC<Props> = ({
  fitnessUrl,
  galleryUrl,
  isAdmin = false,
  features
}) => {
  const {
    order,
    hidden,
    hideItem,
    showItem,
    moveTo,
    restoreOrder,
    commit,
    reset
  } = useNavPreferences()
  const [dragId, setDragId] = useState<NavItemId | null>(null)
  // Carries a sequence number because the same sentence gets announced twice in
  // a row: a live region whose text is unchanged is not a DOM change, so
  // holding "Move down" against the bottom of the list would say "already last"
  // once and then go silent. The number keys the node, so every announcement
  // replaces it whether or not the words moved.
  const [announcement, setAnnouncement] = useState({ text: '', seq: 0 })
  const announce = (text: string) =>
    setAnnouncement((current) => ({ text, seq: current.seq + 1 }))
  // A drag reorders the list as it goes, so an abandoned one has to be undone.
  const orderBeforeDragRef = useRef<NavItemId[] | null>(null)
  const droppedRef = useRef(false)
  const lastOverRef = useRef<NavItemId | null>(null)

  // Only one drag can be live, so a single set of refs serves every row. They
  // are cleared here rather than left for the next drag to overwrite: a stale
  // "order before" would otherwise revert a later, unrelated gesture.
  const endDrag = () => {
    setDragId(null)
    orderBeforeDragRef.current = null
    lastOverRef.current = null
  }

  // A feature the admin turned off still gets a row — greyed out, with the chip
  // that explains why it vanished from the sidebar. Items this account simply
  // does not have (Admin for a regular user) are a permission rather than a
  // preference, so they are left out entirely.
  const rows = useMemo(() => {
    const navParams: BuildNavItemsParams = {
      fitnessUrl,
      galleryUrl,
      isAdmin,
      features
    }
    const available = availableNavIds(navParams)
    const thisAccountsItems = availableNavIds({
      fitnessUrl,
      galleryUrl,
      isAdmin
    })
    return order
      .filter((id) => thisAccountsItems.has(id))
      .map((id) => ({
        item: getNavItem(id, navParams),
        isHidden: hidden.includes(id),
        isFeatureOff: !available.has(id)
      }))
  }, [features, fitnessUrl, galleryUrl, hidden, isAdmin, order])

  // Moves a row to the next position *in this list*, which is what dragging
  // does — the sidebar's ⋯ menu skips over hidden items instead, because there
  // they are not on screen to move past. Here they are.
  const moveRow = (id: NavItemId, label: string, direction: -1 | 1) => {
    const position = rows.findIndex((row) => row.item.id === id)
    const target = rows[position + direction]
    // At either end nothing moves, and reporting a move that did not happen
    // misleads anyone who cannot see the row — so report the end of the list.
    if (!target) {
      announce(`${label} is already ${direction === -1 ? 'first' : 'last'}`)
      return
    }

    moveTo(id, target.item.id)
    commit()
    announce(
      `${label} moved ${direction === -1 ? 'up' : 'down'}, position ${
        position + direction + 1
      } of ${rows.length}`
    )
  }

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    id: NavItemId,
    label: string
  ) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    moveRow(id, label, event.key === 'ArrowUp' ? -1 : 1)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Navigation"
        description="Choose what shows in your sidebar, and in what order. Hidden items stay one click away under More."
      />

      <Section
        icon={PanelLeft}
        title="Sidebar items"
        description="Drag or use the arrows to reorder. Pinned items always show; items your admin turned off are unavailable for everyone. Changes save as you make them."
        actions={
          <>
            <SaveStatus />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                reset()
                announce('Navigation reset to defaults')
              }}
            >
              <History className="h-4 w-4" />
              Reset to defaults
            </Button>
          </>
        }
      >
        <SaveFailure />
        <FramedList aria-label="Sidebar items">
          {rows.map(({ item, isHidden, isFeatureOff }, index) => {
            const draggable = !isFeatureOff
            return (
              <li
                key={item.id}
                draggable={draggable}
                onDragStart={(event) => {
                  if (!draggable) return
                  setDragId(item.id)
                  // Where to put the list back if the drag is abandoned.
                  orderBeforeDragRef.current = order
                  droppedRef.current = false
                  // Firefox abandons a drag whose data store was left empty on
                  // dragstart, so the row would simply refuse to move there.
                  event.dataTransfer?.setData('text/plain', item.id)
                }}
                onDragOver={(event) => {
                  event.preventDefault()
                  if (!dragId) return
                  if (dragId === item.id) {
                    // After a move the dragged row sits under the pointer, so
                    // this fires constantly mid-drag. Recording it is what lets
                    // the row it just passed be crossed again, which is how the
                    // user takes an overshoot back.
                    lastOverRef.current = item.id
                    return
                  }
                  // Move once per row crossed. `dragover` repeats for as long as
                  // the pointer rests on a row, and each one is a move, so
                  // without this the dragged row swaps back and forth under a
                  // cursor that is standing still.
                  if (lastOverRef.current === item.id) return
                  lastOverRef.current = item.id
                  // Reorder as the row is dragged across, so the list shows the
                  // result before the drop. Only the drop is persisted.
                  moveTo(dragId, item.id)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  droppedRef.current = true
                  endDrag()
                  commit()
                }}
                onDragEnd={() => {
                  const before = orderBeforeDragRef.current
                  const wasDragging = Boolean(dragId)
                  const dropped = droppedRef.current
                  endDrag()
                  // Escape, or a release outside the list, ends the drag without
                  // a drop: put the rows back where they were rather than
                  // saving a reorder the user just cancelled. `wasDragging`
                  // keeps a stray dragend — one a non-draggable row can still
                  // fire from a text selection — from replaying an older drag.
                  if (dropped || !wasDragging || !before) return
                  restoreOrder(before)
                  // Anything that saved mid-drag left the account holding the
                  // cancelled order; this puts it back. It is a no-op when
                  // nothing diverged.
                  commit()
                }}
                className={cn(
                  'flex items-center gap-3 transition-colors',
                  FRAMED_LIST_ITEM_CLASS,
                  dragId === item.id && 'bg-primary/5',
                  isFeatureOff ? 'opacity-55' : 'cursor-grab'
                )}
              >
                <button
                  type="button"
                  aria-label={`Reorder ${item.label}: use arrow up and arrow down keys to move`}
                  disabled={isFeatureOff}
                  onKeyDown={(event) =>
                    handleKeyDown(event, item.id, item.label)
                  }
                  // A pointer that cannot hover cannot drag either, so the grip
                  // is only taking width from the label there. The arrows below
                  // keep the row reorderable, keyboard included.
                  className="shrink-0 cursor-grab text-muted-foreground/70 disabled:cursor-default [@media(hover:none)]:hidden"
                >
                  <GripVertical className="h-4 w-4" />
                </button>

                <span
                  className={cn(
                    'grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted',
                    isHidden || isFeatureOff
                      ? 'text-muted-foreground'
                      : 'text-foreground'
                  )}
                >
                  <item.icon className="h-4 w-4" />
                </span>

                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      'flex items-center gap-2 text-sm font-medium',
                      isHidden && 'text-muted-foreground'
                    )}
                  >
                    <span className="truncate">{item.label}</span>
                    {isHidden && !isFeatureOff && <Chip>under More</Chip>}
                    {isFeatureOff && <Chip>off for this server</Chip>}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.blurb}
                  </p>
                </div>

                {/* Dragging needs a mouse and the grip's arrow keys need a
                    keyboard, so on a phone or tablet neither exists. These are
                    the same two moves the sidebar's own ⋯ menu offers. */}
                {!isFeatureOff && (
                  <div className="flex shrink-0 items-center gap-1">
                    {/* aria-disabled, not disabled: a browser blurs a focused
                        element the moment it is disabled, so pressing a row to
                        the end of the list would drop a keyboard user back to
                        the top of the document. Pressing it here says the row
                        is already there instead. */}
                    <button
                      type="button"
                      aria-label={`Move ${item.label} up`}
                      aria-disabled={index === 0}
                      onClick={() => moveRow(item.id, item.label, -1)}
                      className={cn(
                        'grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground',
                        index === 0 && 'opacity-40 hover:bg-transparent'
                      )}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${item.label} down`}
                      aria-disabled={index === rows.length - 1}
                      onClick={() => moveRow(item.id, item.label, 1)}
                      className={cn(
                        'grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground',
                        index === rows.length - 1 &&
                          'opacity-40 hover:bg-transparent'
                      )}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </div>
                )}

                {isFeatureOff ? (
                  <StatusCaption>Admin</StatusCaption>
                ) : item.locked ? (
                  <StatusCaption>Pinned</StatusCaption>
                ) : (
                  <Switch
                    checked={!isHidden}
                    aria-label={`Show ${item.label}`}
                    onCheckedChange={(checked) =>
                      checked ? showItem(item.id) : hideItem(item.id)
                    }
                  />
                )}
              </li>
            )
          })}
        </FramedList>
      </Section>

      <p aria-live="polite" className="sr-only">
        <span key={announcement.seq}>{announcement.text}</span>
      </p>
    </div>
  )
}

// There is no Save button: every change is written as it happens. The quiet
// "Saved" tick sits in the section's actions; a failed save gets an alert with
// the one recovery the page offers.
const SaveStatus = () => {
  const { saveState } = useNavPreferences()
  return <SavedIndicator saved={saveState === 'saved'} />
}

const SaveFailure = () => {
  const { saveState, retry } = useNavPreferences()
  const failed = saveState === 'error'
  // A retry is followed across the save it starts, so the button that started
  // it stays mounted throughout. A browser moves focus to the document body
  // when a focused element unmounts, so rendering the button away mid-save
  // would drop a keyboard user at the top of the page — and bring it back as a
  // new node to Tab to if the save failed again. This is the hazard the row
  // Move buttons avoid by staying put rather than going `disabled`.
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    // The retry has an outcome once the store leaves `saving`: it worked (the
    // tick in the actions says so) or it failed again (the alert re-arms).
    if (retrying && (saveState === 'saved' || saveState === 'error')) {
      setRetrying(false)
    }
  }, [retrying, saveState])

  if (!failed && !retrying) return null

  return (
    <Alert
      title={retrying ? 'Saving your changes…' : 'Couldn’t save your changes'}
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          // Inert while its own save is in flight, without unmounting.
          aria-disabled={!failed}
          className={cn(!failed && 'opacity-60')}
          onClick={() => {
            if (!failed) return
            setRetrying(true)
            retry()
          }}
        >
          Try again
        </Button>
      }
    >
      {retrying
        ? 'Hold on while it is sent again.'
        : 'Your last change may not have reached your account.'}
    </Alert>
  )
}
