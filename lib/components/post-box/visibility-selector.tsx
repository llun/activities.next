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
}

export const VISIBILITY_OPTIONS: {
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

export const QUOTE_POLICY_OPTIONS: {
  value: QuoteApprovalPolicy
  label: string
  Icon: LucideIcon
}[] = [
  { value: 'public', label: 'Anyone', Icon: Globe },
  { value: 'followers', label: 'Followers', Icon: Users },
  { value: 'nobody', label: 'No one', Icon: Ban }
]

interface MenuOptionsProps {
  visibility: MastodonVisibility
  onVisibilityChange: (visibility: MastodonVisibility) => void
  quotePolicy?: QuoteApprovalPolicy
  onQuotePolicyChange?: (policy: QuoteApprovalPolicy) => void
}

/**
 * The visibility choices and, when both quote props are given (the composer's
 * Post options "Visibility" submenu), the "Who can quote" choices. The
 * standalone selector renders the same list without the quote section.
 */
export const VisibilityMenuOptions: FC<MenuOptionsProps> = ({
  visibility,
  onVisibilityChange,
  quotePolicy,
  onQuotePolicyChange
}) => {
  const quoteLabelId = useId()
  const showQuotePolicy =
    quotePolicy !== undefined && Boolean(onQuotePolicyChange)

  return (
    <>
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
                  'bg-primary/10 text-primary-text focus:bg-primary/15 focus:text-primary-text dark:focus:bg-primary/15'
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
                    active && 'text-primary-text'
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
                    'flex min-h-10 cursor-pointer items-center gap-2.5 md:min-h-0',
                    active &&
                      'bg-primary/10 text-primary-text focus:bg-primary/15 focus:text-primary-text dark:focus:bg-primary/15'
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
                      active && 'text-primary-text'
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
    </>
  )
}

export const VisibilitySelector: FC<Props> = ({
  visibility,
  onVisibilityChange,
  disabled
}) => {
  const currentOption =
    VISIBILITY_OPTIONS.find((opt) => opt.value === visibility) ||
    VISIBILITY_OPTIONS[0]
  const CurrentIcon = currentOption.Icon

  const triggerLabel = `Set visibility, current: ${currentOption.label}`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          title={currentOption.label}
          aria-label={triggerLabel}
          className="gap-1.5 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <CurrentIcon className="size-4" />
          <span>{currentOption.label}</span>
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <VisibilityMenuOptions
          visibility={visibility}
          onVisibilityChange={onVisibilityChange}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
