'use client'

import { GripVertical, History, Lock } from 'lucide-react'
import { FC, useMemo, useState } from 'react'

import {
  type BuildNavItemsParams,
  availableNavIds,
  getNavItem
} from '@/lib/components/layout/nav-items'
import { useNavPreferences } from '@/lib/components/layout/nav-preferences-context'
import { PageHeader } from '@/lib/components/page-header'
import { Button } from '@/lib/components/ui/button'
import { Switch } from '@/lib/components/ui/switch'
import {
  type NavFeatureFlags,
  type NavItemId
} from '@/lib/services/navigation/navPreferences'
import { cn } from '@/lib/utils'

interface Props {
  fitnessUrl?: string
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
  isAdmin = false,
  features
}) => {
  const { order, hidden, hideItem, showItem, moveTo, commit, reset } =
    useNavPreferences()
  const [dragId, setDragId] = useState<NavItemId | null>(null)
  const [announcement, setAnnouncement] = useState('')

  // A feature the admin turned off still gets a row — greyed out, with the chip
  // that explains why it vanished from the sidebar. Items this account simply
  // does not have (Admin for a regular user) are a permission rather than a
  // preference, so they are left out entirely.
  const rows = useMemo(() => {
    const navParams: BuildNavItemsParams = { fitnessUrl, isAdmin, features }
    const available = availableNavIds(navParams)
    const thisAccountsItems = availableNavIds({ fitnessUrl, isAdmin })
    return order
      .filter((id) => thisAccountsItems.has(id))
      .map((id) => ({
        item: getNavItem(id, navParams),
        isHidden: hidden.includes(id),
        isFeatureOff: !available.has(id)
      }))
  }, [features, fitnessUrl, hidden, isAdmin, order])

  // The keyboard moves a row to the next position *in this list*, which is what
  // dragging does — the sidebar's ⋯ menu skips over hidden items instead,
  // because there they are not on screen to move past. Here they are.
  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    id: NavItemId,
    label: string
  ) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()

    const direction = event.key === 'ArrowUp' ? -1 : 1
    const position = rows.findIndex((row) => row.item.id === id)
    const target = rows[position + direction]
    // Announce only a move that happened: at either end of the list, nothing
    // does, and saying otherwise misleads anyone who cannot see the row.
    if (!target) {
      setAnnouncement(
        `${label} is already ${direction === -1 ? 'first' : 'last'}`
      )
      return
    }

    moveTo(id, target.item.id)
    commit()
    setAnnouncement(
      `${label} moved ${direction === -1 ? 'up' : 'down'}, position ${
        position + direction + 1
      } of ${rows.length}`
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Navigation"
        description="Choose what shows in your sidebar, and in what order. Hidden items stay one click away under More."
      />

      <section className="space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">Sidebar items</h2>
          <p className="text-sm text-muted-foreground">
            Drag to reorder. Pinned items always show; items your admin turned
            off are unavailable for everyone.
          </p>
        </div>

        <ul className="divide-y overflow-hidden rounded-xl border">
          {rows.map(({ item, isHidden, isFeatureOff }) => {
            const draggable = !isFeatureOff
            return (
              <li
                key={item.id}
                draggable={draggable}
                onDragStart={(event) => {
                  if (!draggable) return
                  setDragId(item.id)
                  // Firefox abandons a drag whose data store was left empty on
                  // dragstart, so the row would simply refuse to move there.
                  event.dataTransfer?.setData('text/plain', item.id)
                }}
                onDragOver={(event) => {
                  event.preventDefault()
                  // Reorder as the row is dragged across, so the list shows the
                  // result before the drop. Only the drop is persisted.
                  if (dragId && dragId !== item.id) moveTo(dragId, item.id)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  setDragId(null)
                  commit()
                }}
                onDragEnd={() => {
                  setDragId(null)
                  commit()
                }}
                className={cn(
                  'flex items-center gap-3 bg-background px-3 py-2.5 transition-colors',
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
                  className="shrink-0 cursor-grab text-muted-foreground/70 disabled:cursor-default"
                >
                  <GripVertical className="h-4 w-4" />
                </button>

                <span
                  className={cn(
                    'grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted',
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
        </ul>

        {/* The caption is the only report a save gives — there is no Save
            button, and each control already announced its own new state — so a
            failure has to reach a screen reader as well as the eye. */}
        <div
          role="status"
          aria-live="polite"
          className="flex w-full items-center justify-between gap-3"
        >
          <SaveCaption />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              reset()
              setAnnouncement('Navigation reset to defaults')
            }}
          >
            <History className="h-4 w-4" />
            Reset to defaults
          </Button>
        </div>
      </section>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  )
}

// There is no Save button: every change is written as it happens, so this
// reports what the store is doing rather than asking for a click.
const SaveCaption = () => {
  const { saveState, retry } = useNavPreferences()

  if (saveState === 'error') {
    return (
      <span className="text-xs text-destructive">
        Couldn&apos;t save your changes.{' '}
        <button type="button" onClick={retry} className="underline">
          Try again
        </button>
      </span>
    )
  }

  return (
    <span className="text-xs text-muted-foreground">
      {saveState === 'saving'
        ? 'Saving…'
        : 'Saved to your account settings as you change it.'}
    </span>
  )
}
