'use client'

import * as DialogPrimitive from '@radix-ui/react-dialog'
import { CalendarDays, ChevronDown, ChevronUp, X } from 'lucide-react'
import {
  CSSProperties,
  FocusEvent,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react'

import { Button } from '@/lib/components/ui/button'
import { Dialog, DialogOverlay, DialogPortal } from '@/lib/components/ui/dialog'
import {
  Popover,
  PopoverAnchor,
  PopoverContent
} from '@/lib/components/ui/popover'
import { formatMonthYear } from '@/lib/fitness/calendar/format'
import {
  DateKey,
  dateKeyParts,
  parseDateKey
} from '@/lib/fitness/calendar/localDay'
import { PickerDraft } from '@/lib/fitness/calendar/overviewState'
import { AppliedRange, PresetKind } from '@/lib/fitness/calendar/ranges'
import { cn } from '@/lib/utils'

import { VisibleMonth } from './MiniMonthCalendar'
import { DraftField, RangePickerPanel } from './RangePickerPanel'
import {
  POPOVER_HEIGHT,
  POPOVER_WIDTH,
  PickerPresentation,
  choosePresentation
} from './rangePickerPresentation'

/** The trigger's visible label: unambiguous about which span is applied. */
export const rangeTriggerLabel = (applied: AppliedRange): string => {
  const { year, month } = dateKeyParts(applied.from)
  switch (applied.kind) {
    case 'this_month':
      return 'This month'
    case 'ytd':
      return 'Year to date'
    case 'last_12_months':
      return 'Last 12 months'
    case 'month':
      return formatMonthYear(year, month)
    case 'year':
      return `Year ${year}`
    case 'custom':
      return 'Custom range'
  }
}

export interface RangePickerProps {
  /** The applied range, which names the trigger. */
  applied: AppliedRange
  today: DateKey
  /** The overview's draft: the picker is open exactly while it is non-null. */
  draft: PickerDraft | null
  /** `yearsForChooser(...)`, newest first. */
  years: readonly number[]
  /** `OPEN_PICKER`. */
  onOpen: () => void
  /** `CHOOSE_PRESET`. */
  onChoosePreset: (preset: PresetKind) => void
  /** `EDIT_DRAFT`. */
  onEditDraft: (field: DraftField, text: string) => void
  /** `CANCEL_PICKER`: Cancel, Escape, the scrim or an outside click. */
  onCancel: () => void
  /** `APPLY_PICKER`. */
  onApply: () => void
  /** `APPLY_YEAR`. */
  onSelectYear: (year: number) => void
  /** Force a presentation instead of measuring. */
  presentation?: 'auto' | PickerPresentation
  /** Show "Range" instead of the span name; the accessible name keeps it. */
  compact?: boolean
  className?: string
}

const monthOf = (key: DateKey): VisibleMonth => {
  const { year, month } = dateKeyParts(key)
  return { year, month }
}

const otherField = (field: DraftField): DraftField =>
  field === 'from' ? 'to' : 'from'

interface SheetBox {
  height: number
  bottom: number
}

/** The visual viewport's size and its gap above the layout viewport's bottom. */
const useVisualViewportBox = (enabled: boolean): SheetBox | null => {
  const [box, setBox] = useState<SheetBox | null>(null)
  useEffect(() => {
    const viewport =
      typeof window === 'undefined' ? null : window.visualViewport
    if (!enabled || !viewport) {
      setBox(null)
      return
    }
    const update = () => {
      setBox({
        height: viewport.height,
        bottom: Math.max(
          0,
          window.innerHeight - viewport.height - viewport.offsetTop
        )
      })
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [enabled])
  return box
}

/**
 * The range picker: a trigger plus the panel it opens. The draft lives in the
 * overview reducer (`picker`), not here, so the picker is open while a draft
 * exists and a change of presentation (popover to sheet, say on rotation or
 * when a keyboard shrinks the viewport) re-renders the same draft.
 *
 * Presentation: an anchored popover only when the whole 710 x 410 panel fits
 * the space measured around the trigger, otherwise a full-width bottom sheet
 * (see `rangePickerPresentation`). Switching keeps the draft, the visible
 * month and the focused control. Escape, Cancel, the scrim and an outside
 * click discard the draft and return focus to the trigger.
 */
export function RangePicker({
  applied,
  today,
  draft,
  years,
  onOpen,
  onChoosePreset,
  onEditDraft,
  onCancel,
  onApply,
  onSelectYear,
  presentation = 'auto',
  compact = false,
  className
}: RangePickerProps) {
  const open = draft !== null
  const triggerRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const focusKeyRef = useRef<string | null>(null)
  const openRef = useRef(open)
  openRef.current = open
  const popoverShownRef = useRef(false)

  const [measured, setMeasured] = useState<PickerPresentation>('sheet')
  const mode: PickerPresentation =
    presentation === 'auto' ? measured : presentation

  const measure = useCallback((): PickerPresentation => {
    const trigger = triggerRef.current
    if (!trigger || typeof window === 'undefined') return 'sheet'
    // The main column's content box: `main` reserves the navigation rail as
    // padding, so its border box would count the rail as room.
    const boundary = trigger.closest<HTMLElement>(
      'main, [data-range-picker-boundary]'
    )
    const box = boundary?.getBoundingClientRect()
    const style = boundary ? window.getComputedStyle(boundary) : null
    const boundaryLeft = box
      ? box.left + (Number.parseFloat(style?.paddingLeft ?? '') || 0)
      : undefined
    const boundaryRight = box
      ? box.right - (Number.parseFloat(style?.paddingRight ?? '') || 0)
      : undefined
    // The popover's real height (an inline error can grow it); the sheet's
    // height says nothing about the popover.
    const panelHeight = popoverShownRef.current
      ? (contentRef.current?.getBoundingClientRect().height ?? 0)
      : 0
    return choosePresentation({
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      },
      trigger: trigger.getBoundingClientRect(),
      boundaryLeft,
      boundaryRight,
      panel: {
        width: POPOVER_WIDTH,
        height: Math.max(POPOVER_HEIGHT, panelHeight)
      }
    })
  }, [])

  // Re-measure when the picker opens (including when the parent opens it) and
  // whenever the window is resized or rotated while it is open.
  useEffect(() => {
    if (!open || presentation !== 'auto') return
    setMeasured(measure())
    const onResize = () => setMeasured(measure())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [open, presentation, measure])

  // The month on screen and the field the next grid tap edits. Both live above
  // the presentation so a switch keeps them.
  const [viewMonth, setViewMonth] = useState<VisibleMonth | null>(null)
  const [activeField, setActiveField] = useState<DraftField>('from')
  useEffect(() => {
    if (!open) {
      setViewMonth(null)
      setActiveField('from')
      focusKeyRef.current = null
    }
  }, [open])

  const fromKey = draft ? parseDateKey(draft.fromText) : null
  const toKey = draft ? parseDateKey(draft.toText) : null
  const defaultKey =
    draft?.kind === 'custom' ? (fromKey ?? toKey) : (toKey ?? fromKey)
  const visibleMonth = viewMonth ?? monthOf(defaultKey ?? today)

  const handleTrigger = () => {
    if (open) {
      onCancel()
      return
    }
    if (presentation === 'auto') setMeasured(measure())
    onOpen()
  }

  const rememberFocus = (event: FocusEvent<HTMLElement>) => {
    const keyed = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-focus-key]'
    )
    const key = keyed?.dataset.focusKey
    if (key) focusKeyRef.current = key
    // Keep the field that the on-screen keyboard raised visible.
    const target = event.target as HTMLElement
    if (target instanceof HTMLInputElement) {
      target.scrollIntoView?.({ block: 'nearest' })
    }
  }

  // Focus on opening, and after a switch of presentation (the new panel is a
  // fresh mount): the control that had it, else the chosen preset.
  const focusInitial = (event: Event) => {
    event.preventDefault()
    const content = contentRef.current
    if (!content) return
    const remembered = focusKeyRef.current
    const target =
      Array.from(
        content.querySelectorAll<HTMLElement>('[data-focus-key]')
      ).find((element) => element.dataset.focusKey === remembered) ??
      content.querySelector<HTMLElement>('[aria-pressed="true"]') ??
      content.querySelector<HTMLElement>('[data-focus-key]')
    target?.focus()
  }

  // The panel unmounts for a real close and for a switch of presentation. Only
  // a real close (the draft is gone) returns focus to the trigger.
  const onCloseAutoFocus = (event: Event) => {
    event.preventDefault()
    if (!openRef.current) triggerRef.current?.focus()
  }

  const handleEdit = (field: DraftField, text: string) => {
    const key = parseDateKey(text)
    if (key !== null) setViewMonth(monthOf(key))
    onEditDraft(field, text)
  }

  const handleSelectDate = (date: DateKey) => {
    handleEdit(activeField, date)
    setActiveField(otherField(activeField))
  }

  const handlePreset = (preset: PresetKind) => {
    setViewMonth(null)
    setActiveField('from')
    onChoosePreset(preset)
  }

  const panel = (layout: PickerPresentation) =>
    draft === null ? null : (
      <div
        ref={contentRef}
        className="flex min-h-0 flex-1 flex-col"
        onFocus={rememberFocus}
        data-testid="range-picker-content"
      >
        <RangePickerPanel
          layout={layout}
          draft={draft}
          today={today}
          years={years}
          visibleMonth={visibleMonth}
          onVisibleMonthChange={setViewMonth}
          onChoosePreset={handlePreset}
          onEditDraft={handleEdit}
          onSelectDate={handleSelectDate}
          onFieldFocus={setActiveField}
          onSelectYear={onSelectYear}
          onCancel={onCancel}
          onApply={onApply}
        />
      </div>
    )

  const label = rangeTriggerLabel(applied)
  const Chevron = open ? ChevronUp : ChevronDown

  popoverShownRef.current = open && mode === 'popover'

  const box = useVisualViewportBox(open && mode === 'sheet')
  const sheetStyle: CSSProperties = {
    maxHeight: box
      ? `${Math.max(0, box.height - 48)}px`
      : 'calc(100dvh - 48px)',
    bottom: box ? `${box.bottom}px` : 0
  }

  return (
    <>
      <Popover
        open={open && mode === 'popover'}
        onOpenChange={(next) => {
          if (!next) onCancel()
        }}
      >
        <PopoverAnchor asChild>
          <Button
            ref={triggerRef}
            type="button"
            variant="outline"
            aria-haspopup="dialog"
            aria-expanded={open}
            data-testid="range-picker-trigger"
            className={cn(
              'h-10 gap-2 px-3 pointer-coarse:h-11',
              open && 'border-primary',
              className
            )}
            onClick={handleTrigger}
          >
            <CalendarDays className="size-4" aria-hidden="true" />
            <span className="sr-only">Date range: {label}</span>
            <span aria-hidden="true">{compact ? 'Range' : label}</span>
            <Chevron className="size-4" aria-hidden="true" />
          </Button>
        </PopoverAnchor>
        <PopoverContent
          aria-label="Date range"
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={16}
          className="flex w-[710px] max-w-[calc(100vw-2rem)] flex-col p-0"
          onOpenAutoFocus={focusInitial}
          onCloseAutoFocus={onCloseAutoFocus}
          onInteractOutside={(event) => {
            // The trigger toggles the picker itself.
            if (triggerRef.current?.contains(event.target as Node)) {
              event.preventDefault()
            }
          }}
        >
          {panel('popover')}
        </PopoverContent>
      </Popover>

      <Dialog
        open={open && mode === 'sheet'}
        onOpenChange={(next) => {
          if (!next) onCancel()
        }}
      >
        <DialogPortal>
          <DialogOverlay />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            data-testid="range-picker-sheet"
            style={sheetStyle}
            onOpenAutoFocus={focusInitial}
            onCloseAutoFocus={onCloseAutoFocus}
            className="bg-background dark:bg-card data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4 motion-reduce:data-[state=open]:slide-in-from-bottom-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 fixed inset-x-0 z-50 flex w-full flex-col rounded-t-2xl border-t shadow-lg duration-200 ease-out outline-none"
          >
            <div className="mx-auto flex min-h-0 w-full max-w-[710px] flex-1 flex-col">
              <div
                aria-hidden="true"
                className="bg-muted-foreground/30 mx-auto mt-2 h-1 w-9 shrink-0 rounded-full"
              />
              <div className="flex shrink-0 items-center justify-between pr-2 pl-4">
                <DialogPrimitive.Title className="text-base font-semibold">
                  Date range
                </DialogPrimitive.Title>
                <DialogPrimitive.Close
                  className="hover:bg-accent focus-visible:ring-ring inline-flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-2"
                  aria-label="Close date range"
                >
                  <X className="size-5" aria-hidden="true" />
                </DialogPrimitive.Close>
              </div>
              {panel('sheet')}
            </div>
          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>
    </>
  )
}
