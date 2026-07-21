import {
  AtSign,
  Ban,
  Check,
  ChevronDown,
  Globe,
  Lock,
  type LucideIcon,
  Unlock,
  Users
} from 'lucide-react'
import { FC, useId } from 'react'

import { Button } from '@/lib/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'
import { QuoteApprovalPolicy } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'
import { MastodonVisibility } from '@/lib/utils/getVisibility'

interface Props {
  visibility: MastodonVisibility
  onVisibilityChange: (visibility: MastodonVisibility) => void
  disabled?: boolean
  // Optional quote-policy control (Mastodon 4.5 quote_approval_policy). When
  // both are provided the same dropdown also renders a "Who can quote" section
  // and the trigger surfaces the active quote-policy icon once it differs from
  // the default "Anyone". Standalone visibility pickers (the fitness/Strava
  // import defaults) omit them and keep the original single-purpose menu.
  quotePolicy?: QuoteApprovalPolicy
  onQuotePolicyChange?: (policy: QuoteApprovalPolicy) => void
}

const VISIBILITY_OPTIONS: {
  value: MastodonVisibility
  label: string
  Icon: LucideIcon
  description: string
}[] = [
  {
    value: 'public',
    label: 'Public',
    Icon: Globe,
    description: 'Visible to everyone, shown in public timelines'
  },
  {
    value: 'unlisted',
    label: 'Unlisted',
    Icon: Unlock,
    description: 'Visible to everyone, hidden from public timelines'
  },
  {
    value: 'private',
    label: 'Followers',
    Icon: Lock,
    description: 'Visible to your followers only'
  },
  {
    value: 'direct',
    label: 'Direct',
    Icon: AtSign,
    description: 'Visible only to mentioned people'
  }
]

const QUOTE_POLICY_OPTIONS: {
  value: QuoteApprovalPolicy
  label: string
  Icon: LucideIcon
}[] = [
  { value: 'public', label: 'Anyone', Icon: Globe },
  { value: 'followers', label: 'Followers', Icon: Users },
  { value: 'nobody', label: 'No one', Icon: Ban }
]

export const VisibilitySelector: FC<Props> = ({
  visibility,
  onVisibilityChange,
  disabled,
  quotePolicy,
  onQuotePolicyChange
}) => {
  const quoteLabelId = useId()

  const currentOption =
    VISIBILITY_OPTIONS.find((opt) => opt.value === visibility) ||
    VISIBILITY_OPTIONS[0]
  const CurrentIcon = currentOption.Icon

  // Only surface the quote section when the composer wires up both the current
  // policy and a change handler.
  const showQuotePolicy =
    quotePolicy !== undefined && Boolean(onQuotePolicyChange)
  const currentQuoteOption = QUOTE_POLICY_OPTIONS.find(
    (opt) => opt.value === quotePolicy
  )
  const QuoteIcon = currentQuoteOption?.Icon

  const triggerTitle =
    showQuotePolicy && currentQuoteOption
      ? `${currentOption.label} · ${currentQuoteOption.label} can quote`
      : currentOption.label
  const triggerLabel =
    showQuotePolicy && currentQuoteOption
      ? `Set visibility and who can quote, current: ${currentOption.label}, ${currentQuoteOption.label} can quote`
      : `Set visibility, current: ${currentOption.label}`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          title={triggerTitle}
          aria-label={triggerLabel}
          className="gap-1.5 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <CurrentIcon className="size-4" />
          <span>{currentOption.label}</span>
          {showQuotePolicy && QuoteIcon && quotePolicy !== 'public' ? (
            <QuoteIcon className="size-3.5 text-primary" />
          ) : null}
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {/* Distinct radio sets: the visibility group and the quote-policy group
            each track their own single selection, so they must be separate,
            named groups rather than one flat run of menuitemradios. */}
        <DropdownMenuGroup aria-label="Visibility">
          {VISIBILITY_OPTIONS.map((option) => {
            const active = option.value === visibility
            const { Icon } = option
            return (
              <DropdownMenuItem
                key={option.value}
                role="menuitemradio"
                aria-checked={active}
                onSelect={() => onVisibilityChange(option.value)}
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
                    className={cn(
                      'block font-medium',
                      active && 'text-primary'
                    )}
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
        </DropdownMenuGroup>

        {showQuotePolicy ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup aria-labelledby={quoteLabelId}>
              <DropdownMenuLabel
                id={quoteLabelId}
                className="px-2 py-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
              >
                Who can quote
              </DropdownMenuLabel>
              {QUOTE_POLICY_OPTIONS.map((option) => {
                const active = option.value === quotePolicy
                const { Icon } = option
                return (
                  <DropdownMenuItem
                    key={option.value}
                    role="menuitemradio"
                    aria-checked={active}
                    onSelect={() => onQuotePolicyChange?.(option.value)}
                    className={cn(
                      'flex cursor-pointer items-center gap-2.5',
                      active &&
                        'bg-primary/10 text-primary focus:bg-primary/15 focus:text-primary'
                    )}
                  >
                    <Icon
                      className={cn(
                        'size-4',
                        active ? 'text-primary' : 'text-muted-foreground'
                      )}
                    />
                    <span
                      className={cn(
                        'min-w-0 flex-1 font-medium',
                        active && 'text-primary'
                      )}
                    >
                      {option.label}
                    </span>
                    {active ? (
                      <Check className="ml-auto size-4 text-primary" />
                    ) : null}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
