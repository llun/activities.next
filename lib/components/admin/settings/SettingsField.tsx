import { FC, ReactNode } from 'react'

import { Label } from '@/lib/components/ui/label'

import { EnvLockBadge, LockedFieldHelp } from './EnvLockBadge'

// A labelled settings field: label (+ env-lock badge when pinned), the control,
// and a help line. When locked, the help is replaced by the "pinned by <var>"
// explanation.
interface SettingsFieldProps {
  label: ReactNode
  htmlFor?: string
  help?: ReactNode
  locked?: boolean
  envVar?: string
  children: ReactNode
}

export const SettingsField: FC<SettingsFieldProps> = ({
  label,
  htmlFor,
  help,
  locked,
  envVar,
  children
}) => {
  const helpContent =
    locked && envVar ? <LockedFieldHelp envVar={envVar} /> : help
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={htmlFor}>{label}</Label>
        {locked && <EnvLockBadge envVar={envVar} />}
      </div>
      {children}
      {helpContent && (
        <p className="text-[0.8rem] text-muted-foreground">{helpContent}</p>
      )}
    </div>
  )
}

// A label/description on the left with a control (usually a Switch) on the
// right. Mirrors the settings ControlRow, plus an optional env-lock badge.
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
}) => (
  <div className="flex items-center justify-between gap-4">
    <div className="min-w-0 space-y-0.5">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={htmlFor} className="cursor-pointer">
          {label}
        </Label>
        {locked && <EnvLockBadge envVar={envVar} />}
      </div>
      {description && (
        <p className="text-[0.8rem] text-muted-foreground">{description}</p>
      )}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
)
