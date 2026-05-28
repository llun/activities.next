import {
  AtSign,
  Check,
  ChevronDown,
  Globe,
  Lock,
  type LucideIcon,
  Unlock
} from 'lucide-react'
import { FC } from 'react'

import { Button } from '@/lib/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { MastodonVisibility } from '@/lib/utils/getVisibility'

interface Props {
  visibility: MastodonVisibility
  onVisibilityChange: (visibility: MastodonVisibility) => void
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
    label: 'Followers only',
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

export const VisibilitySelector: FC<Props> = ({
  visibility,
  onVisibilityChange
}) => {
  const currentOption =
    VISIBILITY_OPTIONS.find((opt) => opt.value === visibility) ||
    VISIBILITY_OPTIONS[0]
  const CurrentIcon = currentOption.Icon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          title={currentOption.label}
          aria-label={`Set visibility, current: ${currentOption.label}`}
          className="gap-1.5 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <CurrentIcon className="size-4" />
          <span>{currentOption.label}</span>
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {VISIBILITY_OPTIONS.map((option) => {
          const active = option.value === visibility
          const { Icon } = option
          return (
            <DropdownMenuItem
              key={option.value}
              role="menuitemradio"
              aria-checked={active}
              onClick={() => onVisibilityChange(option.value)}
              className={cn(
                'flex cursor-pointer items-start gap-2.5',
                active &&
                  'bg-primary/10 text-primary focus:bg-primary/10 focus:text-primary'
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
                    active ? 'text-primary' : 'text-foreground'
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
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
