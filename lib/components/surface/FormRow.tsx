import { FC, ReactNode, useId } from 'react'

import { Label } from '@/lib/components/ui/label'
import { cn } from '@/lib/utils'

/** What a render-prop control receives to wire itself to its row. */
export interface FormRowControlProps {
  /** Put this on the control's `aria-describedby`; absent without a hint. */
  describedBy: string | undefined
}

interface Props {
  label: ReactNode
  /** The `id` of the control the label names. */
  htmlFor?: string
  /** Muted help under the label. */
  hint?: ReactNode
  /**
   * The control. Pass a function to receive the hint's id for
   * `aria-describedby`, or use `formRowHintId(htmlFor)` yourself.
   */
  children: ReactNode | ((props: FormRowControlProps) => ReactNode)
  /** Give the control the rest of the row instead of a ~20rem column. */
  wide?: boolean
  /**
   * A short control (switch, checkbox): it stays at the end of the label's row
   * on a phone too, instead of dropping below it full width.
   */
  inline?: boolean
  className?: string
}

/** The id `FormRow` gives its hint, for controls that wire it up by hand. */
export const formRowHintId = (htmlFor: string) => `${htmlFor}-hint`

/**
 * One row of a settings form, to be set inside a `Frame divided`: the label
 * and its hint on the left and the control on the right from `sm` up, stacked
 * (label and hint above, control full width below) on a phone. `inline` keeps
 * the control on the label's row everywhere; `wide` gives it the row's
 * remaining width.
 */
export const FormRow: FC<Props> = ({
  label,
  htmlFor,
  hint,
  children,
  wide = false,
  inline = false,
  className
}) => {
  const generatedId = useId()
  const hintId = hint ? formRowHintId(htmlFor ?? generatedId) : undefined
  return (
    <div
      data-slot="form-row"
      className={cn(
        'px-4 py-4',
        inline
          ? 'flex items-center justify-between gap-4'
          : cn(
              'flex flex-col gap-3 sm:grid sm:items-center sm:gap-6',
              wide
                ? 'sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]'
                : 'sm:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]'
            ),
        className
      )}
    >
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={htmlFor}>{label}</Label>
        {hint ? (
          <p id={hintId} className="text-muted-foreground text-xs">
            {hint}
          </p>
        ) : null}
      </div>
      <div className={cn('min-w-0', inline && 'shrink-0')}>
        {typeof children === 'function'
          ? children({ describedBy: hintId })
          : children}
      </div>
    </div>
  )
}
