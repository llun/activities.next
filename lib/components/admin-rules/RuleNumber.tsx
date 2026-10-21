import { FC } from 'react'

// The numbered chip that fronts every rule, matching the design system.
export const RuleNumber: FC<{ n: number }> = ({ n }) => (
  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold tabular-nums text-primary-text">
    {n}
  </span>
)
