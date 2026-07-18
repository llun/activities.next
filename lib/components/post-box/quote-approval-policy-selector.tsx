import {
  Ban,
  Check,
  ChevronDown,
  Globe,
  type LucideIcon,
  Users
} from 'lucide-react'
import { FC } from 'react'

import { Button } from '@/lib/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'
import { QuoteApprovalPolicy } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'

interface Props {
  value: QuoteApprovalPolicy
  onChange: (policy: QuoteApprovalPolicy) => void
  disabled?: boolean
}

const QUOTE_POLICY_OPTIONS: {
  value: QuoteApprovalPolicy
  label: string
  Icon: LucideIcon
  description: string
}[] = [
  {
    value: 'public',
    label: 'Anyone can quote',
    Icon: Globe,
    description: 'Everyone may quote this post'
  },
  {
    value: 'followers',
    label: 'Followers can quote',
    Icon: Users,
    description: 'Only your followers may quote this post'
  },
  {
    value: 'nobody',
    label: 'No one can quote',
    Icon: Ban,
    description: 'No one may quote this post'
  }
]

// Composer control mirroring VisibilitySelector: pick who may quote the post
// being written (Mastodon 4.5 quote_approval_policy).
export const QuoteApprovalPolicySelector: FC<Props> = ({
  value,
  onChange,
  disabled
}) => {
  const currentOption =
    QUOTE_POLICY_OPTIONS.find((opt) => opt.value === value) ||
    QUOTE_POLICY_OPTIONS[0]
  const CurrentIcon = currentOption.Icon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          title={currentOption.label}
          aria-label={`Set who can quote, current: ${currentOption.label}`}
          className="gap-1.5 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <CurrentIcon className="size-4" />
          <span>{currentOption.label}</span>
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {QUOTE_POLICY_OPTIONS.map((option) => {
          const active = option.value === value
          const { Icon } = option
          return (
            <DropdownMenuItem
              key={option.value}
              role="menuitemradio"
              aria-checked={active}
              onSelect={() => onChange(option.value)}
              className={cn(
                'flex cursor-pointer items-start gap-2.5',
                active &&
                  'bg-primary/10 text-primary focus:bg-primary/15 focus:text-primary'
              )}
            >
              <Icon
                className={cn(
                  'mt-0.5 size-4',
                  active ? 'text-primary' : 'text-muted-foreground'
                )}
              />
              <span className="min-w-0 flex-1">
                <span
                  className={cn('block font-medium', active && 'text-primary')}
                >
                  {option.label}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {option.description}
                </span>
              </span>
              {active ? (
                <Check className="mt-0.5 ml-auto size-4 text-primary" />
              ) : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
