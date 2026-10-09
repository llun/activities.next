import { Lock } from 'lucide-react'
import { FC, ReactNode } from 'react'

import { Badge } from '@/lib/components/ui/badge'

// Warning badge shown on a field whose value is pinned by an ACTIVITIES_*
// environment variable. env beats database, always, so the field renders
// read-only until the variable is removed.
export const EnvLockBadge: FC<{ envVar?: string }> = ({ envVar }) => (
  <Badge tone="warning" title={envVar}>
    <Lock className="size-3" aria-hidden />
    Set by environment
  </Badge>
)

// A field label carrying the env-lock badge inline. Use this instead of
// SettingsField's `locked` prop when the field is environment-only but keeps
// help text of its own: `locked` replaces the help with the "pinned by <var>"
// line, which is the right story for a field an admin could otherwise edit, and
// the wrong one for a value that is only ever reported.
export const EnvLockLabel: FC<{ envVar?: string; children: ReactNode }> = ({
  envVar,
  children
}) => (
  <span className="inline-flex flex-wrap items-center gap-2">
    {children}
    <EnvLockBadge envVar={envVar} />
  </span>
)

// The help line for a locked field, naming the variable that pinned it.
export const LockedFieldHelp: FC<{ envVar?: string }> = ({ envVar }) =>
  envVar ? (
    <>
      Pinned by{' '}
      <code className="bg-muted rounded px-1 py-px font-mono text-[11px]">
        {envVar}
      </code>{' '}
      — unset it to manage this here.
    </>
  ) : null
