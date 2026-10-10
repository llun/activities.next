'use client'

import { Slider } from '@/lib/components/ui/slider'
import { cn } from '@/lib/utils'

import type { AdjustmentControl } from './adjustmentControls'

interface Props {
  control: AdjustmentControl
  value: number
  disabled?: boolean
  onChange: (value: number) => void
  onGestureStart: () => void
  onGestureEnd: () => void
}

/**
 * One slider with its name on the left and value on the right. A changed
 * value is drawn in the primary colour, semibold.
 */
export const AdjustmentRow = ({
  control,
  value,
  disabled,
  onChange,
  onGestureStart,
  onGestureEnd
}: Props) => (
  <div className="space-y-1" onPointerDownCapture={onGestureStart}>
    <div className="flex items-baseline justify-between text-sm">
      <span>{control.label}</span>
      <span
        data-changed={value !== 0}
        className={cn(
          'tabular-nums',
          value !== 0
            ? 'font-semibold text-primary-text'
            : 'text-muted-foreground'
        )}
      >
        {control.format(value)}
      </span>
    </div>
    <Slider
      label={control.label}
      value={value}
      min={control.min}
      max={control.max}
      step={control.step}
      bipolar
      disabled={disabled}
      formatValue={control.speak}
      onValueChange={onChange}
      onValueCommit={onGestureEnd}
    />
  </div>
)
