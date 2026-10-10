'use client'

import type { LucideIcon } from 'lucide-react'
import { type KeyboardEvent, useId } from 'react'

import { Slider } from '@/lib/components/ui/slider'
import { cn } from '@/lib/utils'

/** One chip and its slider on the phone. */
export interface PhoneControl {
  key: string
  label: string
  icon: LucideIcon
  /** Rotate the icon half a turn (shadows is highlights upside down). */
  flipIcon?: boolean
  min: number
  max: number
  step: number
  /** Fill the slider from zero outward (all but feather and similar). */
  bipolar?: boolean
  /** What a double-click resets to. */
  defaultValue?: number
  format: (value: number) => string
  /** Spoken value for aria-valuetext. */
  speak: (value: number) => string
}

interface Props {
  controls: ReadonlyArray<PhoneControl>
  /** Names the radiogroup: "{label} adjustments". */
  groupLabel: string
  selected: string
  onSelect: (key: string) => void
  valueOf: (key: string) => number
  /** The value that counts as unchanged (drives the dot and the colour). */
  neutralOf?: (key: string) => number
  onChange: (key: string, value: number) => void
  onGestureStart: (key: string) => void
  onGestureEnd: () => void
  disabled: boolean
}

/**
 * A row of 58 px chips (a dot marks a changed value) and one large slider for
 * the chosen chip. Shared by the phone Adjust and Masks tabs.
 */
export const PhoneSliderPanel = ({
  controls,
  groupLabel,
  selected,
  onSelect,
  valueOf,
  neutralOf = () => 0,
  onChange,
  onGestureStart,
  onGestureEnd,
  disabled
}: Props) => {
  const valueId = useId()
  const current =
    controls.find((control) => control.key === selected) ?? controls[0]
  const value = valueOf(current.key)

  const onChipKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = controls.findIndex((chip) => chip.key === current.key)
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? controls[(index + 1) % controls.length]
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? controls[(index - 1 + controls.length) % controls.length]
          : null
    if (!next) return
    event.preventDefault()
    onSelect(next.key)
    event.currentTarget
      .querySelector<HTMLElement>(`[data-chip="${next.key}"]`)
      ?.focus()
  }

  return (
    <>
      <div
        role="radiogroup"
        aria-label={groupLabel}
        onKeyDown={onChipKeyDown}
        className="flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {controls.map((chip) => {
          const chipValue = valueOf(chip.key)
          const active = chip.key === current.key
          const Icon = chip.icon
          return (
            <button
              key={chip.key}
              type="button"
              role="radio"
              aria-checked={active}
              aria-describedby={`${valueId}-${chip.key}`}
              data-chip={chip.key}
              tabIndex={active ? 0 : -1}
              disabled={disabled}
              onClick={() => onSelect(chip.key)}
              className="flex min-h-10 w-[58px] shrink-0 flex-col items-center gap-1 rounded-lg py-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
            >
              <span
                className={cn(
                  'relative flex size-[38px] items-center justify-center rounded-full bg-muted',
                  active && 'ring-2 ring-primary'
                )}
              >
                <Icon
                  aria-hidden="true"
                  className={cn('size-4', chip.flipIcon && 'rotate-180')}
                />
                {chipValue !== neutralOf(chip.key) ? (
                  <span
                    data-testid="changed-dot"
                    aria-hidden="true"
                    className="absolute top-0 right-0 size-1.5 rounded-full bg-primary"
                  />
                ) : null}
              </span>
              <span className="text-[11px] leading-none">{chip.label}</span>
              <span id={`${valueId}-${chip.key}`} className="sr-only">
                {chip.speak(chipValue)}
              </span>
            </button>
          )
        })}
      </div>
      <div
        className="space-y-1 px-4 pb-3"
        onPointerDownCapture={() => onGestureStart(current.key)}
      >
        <div className="flex items-baseline justify-between text-sm">
          <span>{current.label}</span>
          <span
            className={cn(
              'tabular-nums',
              value !== neutralOf(current.key)
                ? 'font-semibold text-primary-text'
                : 'text-muted-foreground'
            )}
          >
            {current.format(value)}
          </span>
        </div>
        <Slider
          label={current.label}
          value={value}
          min={current.min}
          max={current.max}
          step={current.step}
          bipolar={current.bipolar ?? true}
          defaultValue={current.defaultValue}
          disabled={disabled}
          formatValue={current.speak}
          onValueChange={(next) => onChange(current.key, next)}
          onValueCommit={onGestureEnd}
        />
      </div>
    </>
  )
}
