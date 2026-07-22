'use client'

import { useRouter } from 'next/navigation'
import { FC, useState } from 'react'

import { MediasModal } from '@/lib/components/medias-modal/medias-modal'
import { InlineStatusComposer } from '@/lib/components/posts/inline-status-composer'
import { Post } from '@/lib/components/posts/post'
import { useInlineComposer } from '@/lib/components/posts/useInlineComposer'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import {
  Status,
  StatusNote,
  StatusType,
  getOriginalStatus
} from '@/lib/types/domain/status'
import { getStatusDetailPathClient } from '@/lib/utils/getStatusDetailPathClient'
import type { PublicMapProvider } from '@/lib/utils/mapProvider'

import { FitnessStatusDetail } from './FitnessStatusDetail'
import { StatusLikes } from './StatusLikes'

interface Props {
  host: string
  /** Which map backend renders the fitness activity map. */
  mapProvider: PublicMapProvider
  currentTime: number
  currentActor?: ActorProfile | null
  status: Status
  variant?: 'detail' | 'comment'
  isMediaUploadEnabled?: boolean
  // Replies passed through to the fitness activity detail, which renders them
  // in its Comments section instead of the standalone reply list below.
  replies?: Status[]
}

export const StatusBox: FC<Props> = ({
  host,
  mapProvider,
  currentTime,
  currentActor,
  status,
  variant = 'comment',
  isMediaUploadEnabled,
  replies
}) => {
  const router = useRouter()
  const [modalMedias, setModalMedias] = useState<{
    medias: Attachment[]
    initialSelection: number
  } | null>(null)
  // Reply/quote/edit share the same inline composer used by every feed so the
  // status detail page offers the identical action set.
  const composer = useInlineComposer()
  const actualStatus =
    status.type === StatusType.enum.Announce
      ? getOriginalStatus(status)
      : status
  const shouldRenderFitnessDetail =
    variant === 'detail' &&
    actualStatus.type === StatusType.enum.Note &&
    actualStatus.fitness?.processingStatus === 'completed'

  if (shouldRenderFitnessDetail) {
    return (
      <>
        <FitnessStatusDetail
          host={host}
          mapProvider={mapProvider}
          currentTime={currentTime}
          currentActor={currentActor}
          status={actualStatus as StatusNote}
          replies={replies}
          isMediaUploadEnabled={isMediaUploadEnabled}
          onShowAttachment={(allMedias, index) => {
            setModalMedias({ medias: allMedias, initialSelection: index })
          }}
        />
        <MediasModal
          medias={modalMedias?.medias ?? null}
          initialSelection={modalMedias?.initialSelection ?? 0}
          onClosed={() => setModalMedias(null)}
        />
      </>
    )
  }

  const openStatus = (statusToOpen: Status) => {
    void (async () => {
      const detailPath = await getStatusDetailPathClient(statusToOpen)
      if (detailPath) router.push(detailPath)
    })()
  }

  // Authoring actions only apply to the primary (detail) post and a signed-in
  // viewer; comment rows stay read-only.
  const canCompose = variant === 'detail' && Boolean(currentActor)

  return (
    <>
      <article className="p-4 transition-colors">
        <Post
          host={host}
          currentActor={currentActor ?? undefined}
          currentTime={currentTime}
          status={status}
          showActions={variant === 'detail'}
          editable={canCompose && currentActor?.id === actualStatus.actorId}
          collapsible={variant === 'comment'}
          onReply={
            canCompose
              ? (target) => composer.openReply(target, status.id)
              : undefined
          }
          onEdit={
            canCompose
              ? (target) => composer.openEdit(target, status.id)
              : undefined
          }
          onQuote={
            canCompose
              ? (target) => composer.openQuote(target, status.id)
              : undefined
          }
          onOpenStatus={variant === 'comment' ? openStatus : undefined}
          onShowAttachment={(allMedias, index) => {
            setModalMedias({ medias: allMedias, initialSelection: index })
          }}
        />
        {variant === 'detail' && currentActor && (
          <StatusLikes
            statusId={actualStatus.id}
            totalLikes={actualStatus.totalLikes}
          />
        )}
        {composer.active?.anchorId === status.id && currentActor ? (
          <InlineStatusComposer
            key={`${composer.active.mode}-${composer.active.anchorId}`}
            host={host}
            profile={currentActor}
            mode={composer.active.mode}
            status={composer.active.status}
            isMediaUploadEnabled={isMediaUploadEnabled}
            onCancel={composer.close}
            onCreated={() => router.refresh()}
            onUpdated={() => router.refresh()}
          />
        ) : null}
      </article>
      <MediasModal
        medias={modalMedias?.medias ?? null}
        initialSelection={modalMedias?.initialSelection ?? 0}
        onClosed={() => setModalMedias(null)}
      />
    </>
  )
}
