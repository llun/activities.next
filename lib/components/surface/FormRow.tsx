import { FC, ReactNode, useId } from 'react'

import { Label } from '@/lib/components/ui/label'
import { cn } from '@/lib/utils'

/** What a render-prop control receives to wire itself to its row. */
export interface FormRowControlProps {
  /** Put this on the control's `aria-describedby`; absent without a hint. */
  describedBy: string | undefined
  /**
   * Put this on `aria-labelledby` for a control a `<label for>` cannot name (a
   * radio group, a `SegmentedControl`, a custom composite).
   */
  labelledBy: string
}

interface Props {
  label: ReactNode
  /** The `id` of the control the label names. */
  htmlFor?: string
  /** Muted help under the label. */
  hint?: ReactNode
  /**
   * The control. Pass a function to receive the hint's id for
   * `aria-describedby` and the label's for `aria-labelledby`, or use
   * `formRowHintId(htmlFor)` / `formRowLabelId(htmlFor)` yourself.
   */
  children: ReactNode | ((props: FormRowControlProps) => ReactNode)
  /**
   * A short control (switch, checkbox): it stays at the end of the label's row
   * on a phone too, instead of dropping below it full width.
   */
  inline?: boolean
  /**
   * Always stack the label and hint above the control, whatever the viewport.
   * For a form in a narrow single column (the auth cards, a dialog), where the
   * two-column row from `sm` has no room for its control.
   */
  stacked?: boolean
  className?: string
}

/** The id `FormRow` gives its label, for controls that wire it up by hand. */
export const formRowLabelId = (htmlFor: string) => `${htmlFor}-label`

/** The id `FormRow` gives its hint, for controls that wire it up by hand. */
export const formRowHintId = (htmlFor: string) => `${htmlFor}-hint`

/**
 * One row of a settings form, to be set inside a `Frame form` (rows are
 * `px-4 py-2.5`, so two rows sit about 20px apart with no rule): the label
 * and its hint on the left and the control on the right from `sm` up, stacked
 * (label and hint above, control full width below) on a phone. From `sm` up the
 * label takes a third of the row and the control the other two thirds, so every
 * form's fields line up in one column. `inline` keeps the control on the
 * label's row everywhere.
 */
export const FormRow: FC<Props> = ({
  label,
  htmlFor,
  hint,
  children,
  inline = false,
  stacked = false,
  className
}) => {
  const generatedId = useId()
  const idBase = htmlFor ?? generatedId
  const hintId = hint ? formRowHintId(idBase) : undefined
  const labelId = formRowLabelId(idBase)
  return (
    <div
      data-slot="form-row"
      className={cn(
        'px-4 py-2.5',
        inline
          ? 'flex items-center justify-between gap-4'
          : stacked
            ? 'flex flex-col gap-2'
            : 'flex flex-col gap-3 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:items-center sm:gap-6',
        className
      )}
    >
      <div className="min-w-0 space-y-0.5">
        <Label id={labelId} htmlFor={htmlFor}>
          {label}
        </Label>
        {hint ? (
          <p id={hintId} className="text-muted-foreground text-xs">
            {hint}
          </p>
        ) : null}
      </div>
      <div className={cn('min-w-0', inline && 'shrink-0')}>
        {typeof children === 'function'
          ? children({ describedBy: hintId, labelledBy: labelId })
          : children}
      </div>
    </div>
  )
}
