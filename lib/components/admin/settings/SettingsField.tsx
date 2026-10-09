import {
  FC,
  ReactElement,
  ReactNode,
  cloneElement,
  isValidElement
} from 'react'

import { FormRow, formRowHintId } from '@/lib/components/surface/FormRow'

import { EnvLockBadge, LockedFieldHelp } from './EnvLockBadge'

// The admin settings forms' row: a `FormRow` (label and hint on the left, the
// control on the right) that also knows about environment locks. A value pinned
// by an ACTIVITIES_* variable carries the "Set by environment" badge and, in
// place of its help, the "pinned by <var>" explanation.
interface SettingsFieldProps {
  label: ReactNode
  htmlFor?: string
  help?: ReactNode
  locked?: boolean
  envVar?: string
  /** Give the control the rest of the row (a textarea, a picker). */
  wide?: boolean
  children: ReactNode
}

const lockedHint = (
  help: ReactNode,
  locked: boolean | undefined,
  envVar: string | undefined
): ReactNode => {
  if (!locked) return help
  return (
    <>
      <EnvLockBadge envVar={envVar} />
      {envVar ? (
        <>
          {' '}
          <LockedFieldHelp envVar={envVar} />
        </>
      ) : (
        help && <> {help}</>
      )}
    </>
  )
}

// A row's hint (help, or the env-lock explanation) is the control's description:
// when the row names its control by `htmlFor` and holds exactly one element, that
// element gets `aria-describedby` pointing at the hint, so a screen reader reads
// "pinned by ACTIVITIES_..." with the field. A control that brings its own
// `aria-describedby`, or a row of several elements, is left alone.
const describedByHint = (
  children: ReactNode,
  htmlFor: string | undefined,
  hint: ReactNode
): ReactNode => {
  if (!hint || !htmlFor || !isValidElement(children)) return children
  const element = children as ReactElement<{ 'aria-describedby'?: string }>
  if (element.props['aria-describedby'] !== undefined) return children
  return cloneElement(element, { 'aria-describedby': formRowHintId(htmlFor) })
}

export const SettingsField: FC<SettingsFieldProps> = ({
  label,
  htmlFor,
  help,
  locked,
  envVar,
  wide,
  children
}) => {
  const hint = lockedHint(help, locked, envVar)
  return (
    <FormRow label={label} htmlFor={htmlFor} hint={hint} wide={wide}>
      {describedByHint(children, htmlFor, hint)}
    </FormRow>
  )
}

// A label and description on the left with a short control (usually a Switch)
// on the right, kept on one row on a phone. Carries the env-lock badge too.
interface ControlRowProps {
  label: ReactNode
  description?: ReactNode
  htmlFor?: string
  locked?: boolean
  envVar?: string
  children: ReactNode
}

export const ControlRow: FC<ControlRowProps> = ({
  label,
  description,
  htmlFor,
  locked,
  envVar,
  children
}) => {
  // A pinned switch keeps its sentence about what it does; the pinned line
  // goes under it.
  const hint =
    locked && description ? (
      <>
        <span className="block">{description}</span>
        <span className="block">{lockedHint(undefined, locked, envVar)}</span>
      </>
    ) : (
      lockedHint(description, locked, envVar)
    )
  return (
    <FormRow inline label={label} htmlFor={htmlFor} hint={hint}>
      {describedByHint(children, htmlFor, hint)}
    </FormRow>
  )
}
