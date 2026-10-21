'use client'

import { HardDrive } from 'lucide-react'
import { FC } from 'react'

import { DraftsList } from '@/lib/components/drafts/DraftsList'
import { PageHeader } from '@/lib/components/page-header'
import { ActorProfile } from '@/lib/types/domain/actor'

interface Props {
  host: string
  profile: ActorProfile
  currentTime: number
  isMediaUploadEnabled?: boolean
}

export const DraftsPage: FC<Props> = ({
  host,
  profile,
  currentTime,
  isMediaUploadEnabled
}) => (
  <div className="space-y-6">
    <PageHeader
      title="Drafts"
      description={
        <span className="inline-flex items-center gap-1.5">
          <HardDrive aria-hidden className="size-3.5 shrink-0" />
          Saved on this device
        </span>
      }
    />
    <DraftsList
      host={host}
      profile={profile}
      currentTime={currentTime}
      isMediaUploadEnabled={isMediaUploadEnabled}
    />
  </div>
)
