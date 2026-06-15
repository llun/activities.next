'use client'

import { Check } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { FC, useState } from 'react'

import { markNotificationsRead } from '@/lib/client'
import { Button } from '@/lib/components/ui/button'

interface Props {
  // Unread notification ids on the current page (including grouped ids), which
  // the button marks read in one request.
  unreadIds: string[]
  // Total unread count across all notifications, shown as a badge.
  unreadCount: number
}

export const MarkAllReadButton: FC<Props> = ({ unreadIds, unreadCount }) => {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)

  const handleClick = async () => {
    if (unreadIds.length === 0) return
    setIsLoading(true)
    try {
      const ok = await markNotificationsRead({ notificationIds: unreadIds })
      if (ok) router.refresh()
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {unreadCount > 0 && (
        <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        onClick={handleClick}
        disabled={isLoading || unreadIds.length === 0}
      >
        <Check className="size-4" />
        Mark all read
      </Button>
    </div>
  )
}
