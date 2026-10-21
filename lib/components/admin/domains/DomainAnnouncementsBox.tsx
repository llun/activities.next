'use client'

import { Megaphone } from 'lucide-react'
import Link from 'next/link'
import { FC } from 'react'

import {
  type AnnouncementStatusDescriptor,
  computeAnnouncementStatus
} from '@/lib/components/admin-announcements/announcementStatus'
import { Frame } from '@/lib/components/surface/Frame'
import { Badge } from '@/lib/components/ui/badge'
import { Button } from '@/lib/components/ui/button'
import { useHasHydrated } from '@/lib/hooks/useHasHydrated'
import type { AdminAnnouncement } from '@/lib/services/announcements/adminAnnouncement'

const STATUS_TONES: Record<
  AnnouncementStatusDescriptor['tone'],
  'success' | 'primary' | 'gray'
> = {
  green: 'success',
  orange: 'primary',
  gray: 'gray'
}

const formatDateTime = (time: number, utc: boolean): string =>
  new Date(time).toLocaleString(utc ? 'en-US' : undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(utc ? { timeZone: 'UTC' } : null)
  })

const truncate = (text: string, max = 80): string =>
  text.length > max ? `${text.slice(0, max).trimEnd()}…` : text

interface Props {
  domain: string
  /** This domain's published and scheduled announcements, newest first. */
  announcements: AdminAnnouncement[]
  /** Published announcements for every domain showing now, which also show here. */
  allDomainsCount: number
  /** Wall clock from the server, for the status badges. */
  currentTime: number
}

/**
 * The domain page's Announcements box: what this domain's own announcements
 * look like (read-only; they are written in Admin › Announcements), the count
 * of every-domain ones that also show here, and a button that opens the
 * announcements form with "Show on" set to this domain.
 */
export const DomainAnnouncementsBox: FC<Props> = ({
  domain,
  announcements,
  allDomainsCount,
  currentTime
}) => {
  // The server cannot know the viewer's zone: UTC until hydration, then local.
  const hydrated = useHasHydrated()
  return (
    <Frame
      footer={
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="text-muted-foreground text-sm">
            Written in Admin › Announcements.
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link
              href={`/admin/announcements?domain=${encodeURIComponent(domain)}`}
              aria-label={`New announcement for ${domain}`}
            >
              New announcement
            </Link>
          </Button>
        </div>
      }
    >
      <div className="space-y-4 p-4">
        {announcements.length === 0 ? (
          <p className="text-muted-foreground text-sm break-all">
            {domain} has no announcements of its own.
          </p>
        ) : (
          <ul className="space-y-4" aria-label={`Announcements on ${domain}`}>
            {announcements.map((announcement) => {
              const status = computeAnnouncementStatus(
                announcement,
                currentTime
              )
              return (
                <li
                  key={announcement.id}
                  className="flex items-start justify-between gap-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Badge tone={STATUS_TONES[status.tone]}>
                        {status.label}
                      </Badge>
                      <Badge
                        tone="primary"
                        className="max-w-full break-all whitespace-normal"
                      >
                        {domain}
                      </Badge>
                      <span className="text-muted-foreground text-xs">
                        {announcement.starts_at !== null
                          ? `Starts ${formatDateTime(announcement.starts_at, !hydrated)}`
                          : null}
                        {announcement.starts_at !== null &&
                        announcement.ends_at !== null
                          ? ' · '
                          : null}
                        {announcement.ends_at !== null
                          ? `Ends ${formatDateTime(announcement.ends_at, !hydrated)}`
                          : null}
                        {announcement.all_day ? ' · All day' : null}
                      </span>
                    </div>
                    <p className="text-sm break-words whitespace-pre-line">
                      {announcement.text}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <Link
                      href={`/admin/announcements#announcement-${announcement.id}`}
                      aria-label={`Edit announcement ${truncate(announcement.text)}`}
                    >
                      Edit
                    </Link>
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
        {allDomainsCount > 0 ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Megaphone aria-hidden="true" className="size-4 shrink-0" />
            <span>
              Also showing {allDomainsCount}{' '}
              {allDomainsCount === 1 ? 'announcement' : 'announcements'} for all
              domains.{' '}
              <Link
                href="/admin/announcements"
                className="text-primary-text font-medium underline"
              >
                See {allDomainsCount === 1 ? 'it' : 'them'}
              </Link>
            </span>
          </p>
        ) : null}
      </div>
    </Frame>
  )
}
