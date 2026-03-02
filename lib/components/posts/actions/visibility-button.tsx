'use client'

import { Globe, Lock, Mail, Unlock } from 'lucide-react'
import { FC, ReactNode, useState } from 'react'

import { updateStatusVisibility } from '@/lib/client'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'
import { Status, StatusType } from '@/lib/types/domain/status'
import { MastodonVisibility, getVisibility } from '@/lib/utils/getVisibility'

const VISIBILITY_OPTIONS: {
  value: MastodonVisibility
  label: string
  icon: ReactNode
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

interface Props {
  status: Status
}

export const VisibilityButton: FC<Props> = ({ status }) => {
  const initialVisibility =
    status.type !== StatusType.enum.Announce
      ? getVisibility(status.to, status.cc)
      : 'public'

  const [visibility, setVisibility] =
    useState<MastodonVisibility>(initialVisibility)
  const [saving, setSaving] = useState(false)

  if (status.type === StatusType.enum.Announce) return null

  const currentOption =
    VISIBILITY_OPTIONS.find((opt) => opt.value === visibility) ??
    VISIBILITY_OPTIONS[0]

  const handleChange = async (newVisibility: MastodonVisibility) => {
    if (newVisibility === visibility || saving) return
    const previous = visibility
    setVisibility(newVisibility)
    setSaving(true)
    const success = await updateStatusVisibility({
      statusId: status.id,
      visibility: newVisibility
    })
    setSaving(false)
    if (!success) {
      setVisibility(previous)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-1.5 rounded-full px-2 py-1 text-sm hover:bg-muted transition-colors disabled:opacity-50"
          title={currentOption.label}
          aria-label={`Visibility: ${currentOption.label}`}
          disabled={saving}
          onClick={(e) => e.stopPropagation()}
        >
          {currentOption.icon}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {VISIBILITY_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={(e) => {
              e.stopPropagation()
              void handleChange(option.value)
            }}
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
