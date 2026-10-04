'use client'

import { FormEvent, ReactNode, useId, useMemo, useRef } from 'react'

import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import { DateKey, parseDateKey } from '@/lib/fitness/calendar/localDay'
import { PickerDraft } from '@/lib/fitness/calendar/overviewState'
import {
  DRAFT_ERROR_MESSAGES,
  DraftError,
  MIN_DATE_KEY,
  PresetKind,
  validateDraft
} from '@/lib/fitness/calendar/ranges'
import { cn } from '@/lib/utils'

import { MiniMonthCalendar, VisibleMonth } from './MiniMonthCalendar'
import { YearChooser } from './YearChooser'

export type RangePickerLayout = 'popover' | 'sheet'

export const PRESET_OPTIONS: readonly { kind: PresetKind; label: string }[] = [
  { kind: 'this_month', label: 'This month' },
  { kind: 'ytd', label: 'Year to date' },
  { kind: 'last_12_months', label: 'Last 12 months' }
]

export type DraftField = 'from' | 'to'

export interface RangePickerPanelProps {
  /** `popover`: three columns. `sheet`: one column, every target 44px. */
  layout: RangePickerLayout
  draft: PickerDraft
  today: DateKey
  /** Years for the chooser, newest first. */
  years: readonly number[]
  visibleMonth: VisibleMonth
  onVisibleMonthChange: (month: VisibleMonth) => void
  onChoosePreset: (preset: PresetKind) => void
  onEditDraft: (field: DraftField, text: string) => void
  /** A day tapped in the month grid. */
  onSelectDate: (date: DateKey) => void
  /** A field gained focus: the grid's next tap edits that field. */
  onFieldFocus: (field: DraftField) => void
  onSelectYear: (year: number) => void
  onCancel: () => void
  onApply: () => void
}

const errorsFor = (errors: DraftError[], fields: DraftError['field'][]) =>
  errors.filter((error) => fields.includes(error.field))

function FieldError({ id, errors }: { id: string; errors: DraftError[] }) {
  if (errors.length === 0) return null
  return (
    <p id={id} className="text-destructive-text text-xs" data-testid={id}>
      {errors.map((error) => DRAFT_ERROR_MESSAGES[error.code]).join('. ')}
    </p>
  )
}

/**
 * The picker's contents, shared by the popover and the sheet: presets, the
 * calendar-year chooser, labelled From and To dates, a month grid and
 * Cancel/Apply. It is purely controlled by the overview draft; nothing here is
 * applied until Apply, and Apply stays disabled while the draft is invalid.
 */
export function RangePickerPanel({
  layout,
  draft,
  today,
  years,
  visibleMonth,
  onVisibleMonthChange,
  onChoosePreset,
  onEditDraft,
  onSelectDate,
  onFieldFocus,
  onSelectYear,
  onCancel,
  onApply
}: RangePickerPanelProps) {
  const sheet = layout === 'sheet'
  const ids = useId()
  const fromId = `${ids}-from`
  const toId = `${ids}-to`
  const fromErrorId = `${ids}-from-error`
  const toErrorId = `${ids}-to-error`
  const rangeErrorId = `${ids}-range-error`
  const hintId = `${ids}-hint`
  const fromInput = useRef<HTMLInputElement>(null)

  const validation = useMemo(() => validateDraft(draft, today), [draft, today])
  const errors = validation.ok ? [] : validation.errors
  const fromErrors = errorsFor(errors, ['from'])
  const toErrors = errorsFor(errors, ['to'])
  const rangeErrors = errorsFor(errors, ['range'])

  const fromKey = parseDateKey(draft.fromText)
  const toKey = parseDateKey(draft.toText)
  const yearValue = fromKey === null ? null : Number(fromKey.slice(0, 4))

  const describe = (own: string, hasOwn: boolean) =>
    [
      hasOwn ? own : null,
      rangeErrors.length > 0 ? rangeErrorId : null,
      errors.length === 0 ? hintId : null
    ]
      .filter(Boolean)
      .join(' ') || undefined

  const inputClass = sheet ? 'h-11' : 'h-9 pointer-coarse:h-11'

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (validation.ok) onApply()
  }

  const presets = (
    <div
      role="group"
      aria-label="Range presets"
      className={cn(sheet ? 'grid grid-cols-2 gap-2' : 'flex flex-col gap-0.5')}
    >
      {PRESET_OPTIONS.map((preset) => (
        <PresetButton
          key={preset.kind}
          sheet={sheet}
          pressed={draft.kind === preset.kind}
          focusKey={`preset-${preset.kind}`}
          onClick={() => onChoosePreset(preset.kind)}
        >
          {preset.label}
        </PresetButton>
      ))}
      <PresetButton
        sheet={sheet}
        pressed={draft.kind === 'custom'}
        focusKey="preset-custom"
        onClick={() => fromInput.current?.focus()}
      >
        Custom
      </PresetButton>
    </div>
  )

  const chooser = (
    <YearChooser
      years={years}
      value={yearValue}
      onSelect={onSelectYear}
      touch={sheet}
    />
  )

  const dateField = (
    field: DraftField,
    label: string,
    id: string,
    errorId: string,
    fieldErrors: DraftError[],
    ref?: React.Ref<HTMLInputElement>
  ) => (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        ref={ref}
        id={id}
        type="date"
        data-focus-key={field}
        min={MIN_DATE_KEY}
        max={today}
        value={field === 'from' ? draft.fromText : draft.toText}
        aria-invalid={
          fieldErrors.length > 0 || rangeErrors.length > 0 || undefined
        }
        aria-describedby={describe(errorId, fieldErrors.length > 0)}
        className={inputClass}
        onFocus={() => onFieldFocus(field)}
        onChange={(event) => onEditDraft(field, event.target.value)}
      />
    </div>
  )

  const fields = (
    <div className="flex flex-col gap-2">
      <div className={cn('grid gap-3', sheet ? 'grid-cols-2' : 'grid-cols-1')}>
        {dateField('from', 'From', fromId, fromErrorId, fromErrors, fromInput)}
        {dateField('to', 'To', toId, toErrorId, toErrors)}
      </div>
      <FieldError id={fromErrorId} errors={fromErrors} />
      <FieldError id={toErrorId} errors={toErrors} />
      <FieldError id={rangeErrorId} errors={rangeErrors} />
      {errors.length === 0 && (
        <p id={hintId} className="text-muted-foreground text-xs">
          {draft.kind === 'custom'
            ? 'Draft only. The dashboard keeps the applied range until you press Apply.'
            : 'Applies when you press Apply.'}
        </p>
      )}
    </div>
  )

  const calendar = (
    <MiniMonthCalendar
      visible={visibleMonth}
      onVisibleChange={onVisibleMonthChange}
      today={today}
      from={fromKey}
      to={toKey}
      onSelectDate={onSelectDate}
      touch={sheet}
    />
  )

  const footer = (
    <div
      className={cn(
        'border-t',
        sheet
          ? 'grid grid-cols-2 gap-3 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)]'
          : 'flex justify-end gap-2 px-4 py-3'
      )}
    >
      <Button
        type="button"
        variant="outline"
        data-focus-key="cancel"
        className={sheet ? 'h-11' : 'pointer-coarse:h-11'}
        onClick={onCancel}
      >
        Cancel
      </Button>
      <Button
        type="submit"
        data-focus-key="apply"
        disabled={!validation.ok}
        className={sheet ? 'h-11' : 'pointer-coarse:h-11'}
      >
        Apply
      </Button>
    </div>
  )

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      data-layout={layout}
      className="flex min-h-0 flex-1 flex-col"
    >
      {sheet ? (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pb-4">
          {presets}
          {chooser}
          {fields}
          {calendar}
        </div>
      ) : (
        // On a coarse pointer (a tablet's popover) the month grid's days are
        // 44px, so its column must hold 7 x 44 = 308px: the two left columns
        // narrow to 11rem and the paddings to 12px, which leaves it 334px.
        // Otherwise the 44px day buttons were squeezed to 38px wide.
        <div className="grid grid-cols-[13.25rem_12.25rem_minmax(0,1fr)] pointer-coarse:grid-cols-[11rem_11rem_minmax(0,1fr)]">
          <Column className="gap-4 border-r p-3">
            {presets}
            {chooser}
          </Column>
          <Column className="border-r p-4 pointer-coarse:p-3">{fields}</Column>
          <Column className="p-4 pointer-coarse:p-3">{calendar}</Column>
        </div>
      )}
      {footer}
    </form>
  )
}

function Column({
  className,
  children
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('flex min-w-0 flex-col', className)}>{children}</div>
  )
}

function PresetButton({
  sheet,
  pressed,
  focusKey,
  onClick,
  children
}: {
  sheet: boolean
  pressed: boolean
  focusKey: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      data-focus-key={focusKey}
      onClick={onClick}
      className={cn(
        'focus-visible:ring-ring rounded-md text-sm outline-none focus-visible:ring-2',
        sheet
          ? 'min-h-11 border px-3 text-center'
          : 'min-h-10 px-3 text-left pointer-coarse:min-h-11',
        pressed
          ? sheet
            ? 'border-primary bg-primary/10 text-primary-text'
            : 'bg-primary/10 text-primary-text'
          : 'hover:bg-accent'
      )}
    >
      {children}
    </button>
  )
}
