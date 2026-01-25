import { Globe, Lock, Mail, Unlock } from 'lucide-react'
import { FC } from 'react'

import { Button } from '@/lib/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'
import { MastodonVisibility } from '@/lib/utils/getVisibility'

interface Props {
  visibility: MastodonVisibility
  onVisibilityChange: (visibility: MastodonVisibility) => void
}

const VISIBILITY_OPTIONS: {
  value: MastodonVisibility
  label: string
  icon: React.ReactNode
  description: string
}[] = [
  {
    value: 'public',
    label: 'Public',
    icon: <Globe className="size-4" />,
    description: 'Visible to everyone'
  },
  {
    value: 'unlisted',
    label: 'Unlisted',
    icon: <Unlock className="size-4" />,
    description: 'Not shown in public timelines'
  },
  {
    value: 'private',
    label: 'Followers only',
    icon: <Lock className="size-4" />,
    description: 'Only visible to your followers'
  },
  {
    value: 'direct',
    label: 'Direct',
    icon: <Mail className="size-4" />,
    description: 'Only mentioned users'
  }
]

export const VisibilitySelector: FC<Props> = ({
  visibility,
  onVisibilityChange
}) => {
  const currentOption =
    VISIBILITY_OPTIONS.find((opt) => opt.value === visibility) ||
    VISIBILITY_OPTIONS[0]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="link"
          title={currentOption.label}
          aria-label={currentOption.label}
        >
          {currentOption.icon}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {VISIBILITY_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => onVisibilityChange(option.value)}
            className="flex items-start gap-3 cursor-pointer"
          >
            <div className="mt-0.5">{option.icon}</div>
            <div className="flex-1">
              <div className="font-medium">{option.label}</div>
              <div className="text-xs text-muted-foreground">
                {option.description}
              </div>
            </div>
            {option.value === visibility && (
              <div className="text-primary">✓</div>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
