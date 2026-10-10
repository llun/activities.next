'use client'

import * as RadixSlider from '@radix-ui/react-slider'
import * as React from 'react'

import { cn } from '@/lib/utils'

type SliderProps = Omit<
  RadixSlider.SliderProps,
  'value' | 'defaultValue' | 'onValueChange' | 'onValueCommit'
> & {
  value: number
  onValueChange: (value: number) => void
  onValueCommit?: (value: number) => void
  /** Fill from zero instead of from the minimum. */
  bipolar?: boolean
  /** The value a double-click or Delete resets to. Defaults to 0. */
  defaultValue?: number
  /** The thumb's accessible name. */
  label: string
  /** The thumb's `aria-valuetext`. */
  formatValue?: (value: number) => string
}

/**
 * A single-thumb slider on Radix. Double-click anywhere on it, or Delete /
 * Backspace on the focused thumb, resets it to `defaultValue`. A `bipolar`
 * slider draws its fill outward from zero and marks the zero point.
 */
function Slider({
  value,
  onValueChange,
  onValueCommit,
  bipolar = false,
  defaultValue = 0,
  label,
  formatValue,
  min = 0,
  max = 100,
  step = 1,
  className,
  ...props
}: SliderProps) {
  const span = max - min || 1
  const position = Math.min(100, Math.max(0, ((value - min) / span) * 100))
  const zero = Math.min(100, Math.max(0, ((0 - min) / span) * 100))

  const reset = () => {
    onValueChange(defaultValue)
    onValueCommit?.(defaultValue)
  }

  return (
    <RadixSlider.Root
      data-slot="slider"
      min={min}
      max={max}
      step={step}
      {...props}
      value={[value]}
      onValueChange={([next]) => onValueChange(next)}
      onValueCommit={([next]) => onValueCommit?.(next)}
      onDoubleClick={(event) => {
        props.onDoubleClick?.(event)
        if (!event.defaultPrevented) reset()
      }}
      className={cn(
        'relative flex h-6 w-full touch-none items-center select-none data-[disabled]:opacity-50',
        className
      )}
    >
      <RadixSlider.Track
        data-slot="slider-track"
        className="relative h-1 w-full grow overflow-hidden rounded-full bg-muted"
      >
        <RadixSlider.Range
          data-slot="slider-range"
          className={cn('absolute h-full bg-primary', bipolar && 'hidden')}
        />
        {bipolar ? (
          <>
            <span
              data-slot="slider-fill"
              aria-hidden="true"
              className="absolute h-full bg-primary"
              style={{
                left: `${Math.min(zero, position)}%`,
                width: `${Math.abs(position - zero)}%`
              }}
            />
            <span
              data-slot="slider-tick"
              aria-hidden="true"
              className="absolute top-0 h-full w-px bg-border"
              style={{ left: `${zero}%` }}
            />
          </>
        ) : null}
      </RadixSlider.Track>
      <RadixSlider.Thumb
        data-slot="slider-thumb"
        aria-label={label}
        aria-valuetext={formatValue?.(value)}
        onKeyDown={(event) => {
          if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault()
            reset()
          }
        }}
        className="block size-6 shrink-0 rounded-full border-2 border-primary bg-background shadow-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none md:size-4"
      />
    </RadixSlider.Root>
  )
}

export { Slider }
export type { SliderProps }
