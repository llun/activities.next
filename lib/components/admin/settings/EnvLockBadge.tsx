import { Lock } from 'lucide-react'
import { FC } from 'react'

// Amber "Set by environment" badge shown on a field whose value is pinned by an
// ACTIVITIES_* environment variable. env beats database, always — so the field
// renders read-only until the variable is removed.
export const EnvLockBadge: FC<{ envVar?: string }> = ({ envVar }) => (
  <span
    title={envVar}
    className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
  >
    <Lock className="h-3 w-3" aria-hidden />
    Set by environment
  </span>
)

// The help line for a locked field, naming the variable that pins it.
export const LockedFieldHelp: FC<{ envVar?: string }> = ({ envVar }) =>
  envVar ? (
    <>
      Pinned by{' '}
      <code className="rounded bg-muted px-1 py-px font-mono text-[11px]">
        {envVar}
      </code>{' '}
      — unset it to manage this here.
    </>
  ) : null
