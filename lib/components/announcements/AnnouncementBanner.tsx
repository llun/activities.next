'use client'

import { Megaphone, X } from 'lucide-react'
import { FC, useEffect, useMemo, useState } from 'react'

import { dismissAnnouncement, getAnnouncements } from '@/lib/client'
import { Button } from '@/lib/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle
} from '@/lib/components/ui/card'
import type { Announcement } from '@/lib/types/mastodon/announcement'
import { cleanClassName } from '@/lib/utils/text/cleanClassName'

interface AnnouncementCardProps {
  host: string
  announcement: Announcement
  onDismiss: (id: string) => void
}

const AnnouncementCard: FC<AnnouncementCardProps> = ({
  announcement,
  onDismiss
}) => {
  // The announcement content is markdown-rendered and sanitized HTML produced
  // server-side by the same status pipeline (convertMarkdownText -> sanitizeText
  // -> sanitizeTrustedStatusText in getMastodonAnnouncement), so the only
  // remaining step is turning that HTML into React nodes — the final
  // `cleanClassName` step the Post component runs. We never use
  // dangerouslySetInnerHTML.
  const content = useMemo(
    () => cleanClassName(announcement.content),
    [announcement.content]
  )

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Megaphone className="size-4 text-primary" />
          Announcement
        </CardTitle>
        <CardAction>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Dismiss announcement"
            onClick={() => onDismiss(announcement.id)}
          >
            <X className="size-4" />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="text-sm leading-relaxed break-words [&_a]:text-sky-600 dark:[&_a]:text-sky-400 [&_a]:underline [&_a]:underline-offset-2 [&_p]:mb-2 last:[&_p]:mb-0">
        {content}
      </CardContent>
    </Card>
  )
}

interface AnnouncementBannerProps {
  host: string
  // Forwarded for consistency with other timeline client components; the banner
  // does not currently render relative timestamps, so it never reads the wall
  // clock during render.
  currentTime: number
}

export const AnnouncementBanner: FC<AnnouncementBannerProps> = ({ host }) => {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])

  useEffect(() => {
    let active = true
    getAnnouncements()
      .then((loaded) => {
        if (!active) return
        setAnnouncements(loaded.filter((announcement) => !announcement.read))
      })
      .catch(() => {
        // A failure to load announcements degrades to showing no banner rather
        // than surfacing an error on the timeline.
      })
    return () => {
      active = false
    }
  }, [])

  const onDismiss = (id: string) => {
    // Optimistically hide the dismissed announcement; the server call marks it
    // read so it does not return on the next load.
    setAnnouncements((previous) =>
      previous.filter((announcement) => announcement.id !== id)
    )
    void dismissAnnouncement(id)
  }

  if (announcements.length === 0) return null

  return (
    <div className="space-y-4">
      {announcements.map((announcement) => (
        <AnnouncementCard
          key={announcement.id}
          host={host}
          announcement={announcement}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  )
}
