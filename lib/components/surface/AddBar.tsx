import { Plus } from 'lucide-react'
import {
  type ComponentProps,
  type ComponentType,
  FC,
  FormEventHandler,
  ReactNode,
  Ref,
  useId
} from 'react'

import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import { cn } from '@/lib/utils'

interface AddBarProps {
  /**
   * What the box adds ("New rule"). The label names the input for assistive
   * tech and is visually hidden: the Section title above the box is the
   * visible heading.
   */
  label: string
  /** The Add button's text; "Add" by default. */
  buttonLabel?: string
  /** The Add button's icon; a plus by default. */
  buttonIcon?: ComponentType<{ className?: string }>
  /** Disables the button (and not the field), e.g. while the field is empty. */
  buttonDisabled?: boolean
  /** A short mark inside the field's start, such as `#`. */
  prefix?: ReactNode
  /** Muted help under the row, wired to the input's `aria-describedby`. */
  hint?: ReactNode
  /**
   * A field validation error, shown in the box under the row. A failed
   * request is an `Alert` card placed above the bar instead.
   */
  error?: ReactNode
  /** A server action; the form submits to it. Use `onSubmit` for client state. */
  action?: ComponentProps<'form'>['action']
  /** Called on submit (button or Enter). The page calls `preventDefault`. */
  onSubmit?: FormEventHandler<HTMLFormElement>
  /** The input's `id`; generated when absent. */
  id?: string
  inputRef?: Ref<HTMLInputElement>
  /** Everything else for the input: `name`, `value`, `onChange`, `type`, ... */
  inputProps?: Omit<
    ComponentProps<'input'>,
    'id' | 'ref' | 'aria-label' | 'prefix'
  >
  /**
   * Set in the row's `relative` wrapper under the input, for a dropdown that
   * opens below the field (`absolute top-full`).
   */
  dropdown?: ReactNode
  /** More lines for the box under the row (a status line, a limit note). */
  children?: ReactNode
  className?: string
}

/**
 * The box that adds one short item: the input and the Add button on one row
 * inside one bordered box, in a real `<form>` so Enter submits. Errors and
 * notes sit inside the box under the row. Use it for a hashtag, a rule, a
 * relay inbox or a domain; a form with several fields is a `Frame form` of
 * `FormRow`s with a `SaveBar` instead.
 */
export const AddBar: FC<AddBarProps> = ({
  label,
  buttonLabel = 'Add',
  buttonIcon: ButtonIcon = Plus,
  buttonDisabled,
  prefix,
  hint,
  error,
  action,
  onSubmit,
  id,
  inputRef,
  inputProps,
  dropdown,
  children,
  className
}) => {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const hintId = hint ? `${inputId}-hint` : undefined
  const errorId = error ? `${inputId}-error` : undefined
  const describedBy =
    [inputProps?.['aria-describedby'], hintId, errorId]
      .filter(Boolean)
      .join(' ') || undefined
  return (
    <form
      data-slot="add-bar"
      action={action}
      onSubmit={onSubmit}
      className={cn('bg-background rounded-lg border p-4', className)}
    >
      <div className="relative">
        <div className="flex items-stretch gap-2">
          <div className="relative min-w-0 flex-1">
            {prefix ? (
              <span
                aria-hidden="true"
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 flex -translate-y-1/2 items-center"
              >
                {prefix}
              </span>
            ) : null}
            <Label htmlFor={inputId} className="sr-only">
              {label}
            </Label>
            <Input
              {...inputProps}
              id={inputId}
              ref={inputRef}
              aria-describedby={describedBy}
              aria-invalid={error ? true : inputProps?.['aria-invalid']}
              className={cn(prefix && 'pl-8', inputProps?.className)}
            />
          </div>
          <Button type="submit" disabled={buttonDisabled} className="shrink-0">
            <ButtonIcon className="size-4" />
            {buttonLabel}
          </Button>
        </div>
        {dropdown}
      </div>
      {hint ? (
        <p id={hintId} className="text-muted-foreground mt-2 text-xs">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="text-destructive-text mt-2 text-xs"
        >
          {error}
        </p>
      ) : null}
      {children}
    </form>
  )
}
