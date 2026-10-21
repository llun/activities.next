import { FC } from 'react'

import { Badge } from '@/lib/components/ui/badge'

/** The outlined chip that marks a rule or announcement shared by every domain. */
export const AllDomainsChip: FC = () => (
  <Badge
    tone="primary"
    className="border-primary/30 bg-background dark:bg-background shrink-0 border"
  >
    All domains
  </Badge>
)
