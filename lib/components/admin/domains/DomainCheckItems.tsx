import { Check, Minus, X } from 'lucide-react'
import { FC } from 'react'

import type { AdminDomainCheck } from '@/lib/services/domains/adminDomainTypes'
import { cn } from '@/lib/utils'

import {
  DOMAIN_CHECK_ITEM_TITLES,
  getDomainCheckItemDetail
} from './domainLabels'

interface Props {
  domain: string
  check: AdminDomainCheck
  className?: string
}

const ICONS = {
  passed: { Icon: Check, className: 'text-success-text', label: 'Passed' },
  failed: { Icon: X, className: 'text-destructive-text', label: 'Failed' },
  skipped: {
    Icon: Minus,
    className: 'text-muted-foreground',
    label: 'Not checked'
  }
} as const

/** The three lines of a reachability check: DNS, TLS, the Host header. */
export const DomainCheckItems: FC<Props> = ({ domain, check, className }) => (
  <ul className={cn('mt-2 space-y-2', className)}>
    {check.items.map((item) => {
      const { Icon, className: iconClassName, label } = ICONS[item.status]
      return (
        <li key={item.key} className="flex items-start gap-2">
          <Icon
            aria-hidden="true"
            className={cn('mt-0.5 size-4 shrink-0', iconClassName)}
          />
          <div className="min-w-0">
            <p className="text-foreground font-medium">
              {DOMAIN_CHECK_ITEM_TITLES[item.key]}
              <span className="sr-only">: {label}</span>
            </p>
            <p className="text-muted-foreground text-xs">
              {getDomainCheckItemDetail(domain, item, check.reason)}
            </p>
          </div>
        </li>
      )
    })}
  </ul>
)
