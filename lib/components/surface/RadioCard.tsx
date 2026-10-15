'use client'

import { type ComponentType, FC, ReactNode, useId } from 'react'

import { RadioGroupItem } from '@/lib/components/ui/radio-group'
import { cn } from '@/lib/utils'

interface RadioCardProps {
  /** The value this card selects in the enclosing `RadioGroup`. */
  value: string
  title: ReactNode
  /** Muted help under the title. */
  hint?: ReactNode
  /** A small icon before the title. */
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>
  /** Base for the radio's id; generated when absent. */
  id?: string
  disabled?: boolean
  className?: string
}

/**
 * One choice of a short, explained list, set inside a `RadioGroup`: the radio
 * on the left, an optional small icon, the title and its hint. The chosen card
 * gets a tinted border and a soft tinted background. The whole card is the
 * click target, and keyboard and focus are the `RadioGroup`'s own (arrow keys
 * move the choice, one tab stop for the group). The radio is named by the
 * title and described by the hint, so a screen reader does not read both as
 * the name.
 */
export const RadioCard: FC<RadioCardProps> = ({
  value,
  title,
  hint,
  icon: Icon,
  id,
  disabled,
  className
}) => {
  const generatedId = useId()
  const base = id ?? generatedId
  const titleId = `${base}-title`
  const hintId = hint ? `${base}-hint` : undefined
  return (
    <label
      data-slot="radio-card"
      htmlFor={base}
      // The radio is a Radix `<button role="radio">`, never a native input, so
      // `:checked` can not see it: `data-state` marks the chosen card.
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
        'hover:bg-muted/40 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5',
        'has-focus-visible:ring-ring/50 has-focus-visible:ring-[3px]',
        disabled && 'cursor-not-allowed opacity-60',
        className
      )}
    >
      <RadioGroupItem
        id={base}
        value={value}
        disabled={disabled}
        aria-labelledby={titleId}
        aria-describedby={hintId}
        className="mt-0.5 shrink-0"
      />
      <span className="min-w-0 flex-1 space-y-0.5">
        <span
          id={titleId}
          className="flex items-center gap-1.5 text-sm leading-5 font-medium"
        >
          {Icon ? (
            <Icon
              aria-hidden="true"
              className="text-muted-foreground size-3.5"
            />
          ) : null}
          {title}
        </span>
        {hint ? (
          <span
            id={hintId}
            className="text-muted-foreground block text-xs font-normal"
          >
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  )
}
