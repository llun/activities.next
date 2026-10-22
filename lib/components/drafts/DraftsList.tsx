'use client'

import { FileText } from 'lucide-react'
import { FC, useCallback, useEffect, useRef, useState } from 'react'

import {
  type DraftRecord,
  listDrafts,
  subscribeDraftsMessages
} from '@/lib/client/drafts'
import { Alert } from '@/lib/components/surface/Alert'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { FramedList, FramedListItem } from '@/lib/components/surface/FramedList'
import { Section } from '@/lib/components/surface/Section'
import { SkeletonRows } from '@/lib/components/surface/Skeleton'
import { ActorProfile } from '@/lib/types/domain/actor'

import { DraftEditor } from './DraftEditor'
import { DraftRow } from './DraftRow'

interface Props {
  host: string
  profile: ActorProfile
  currentTime: number
  isMediaUploadEnabled?: boolean
}

type ListState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'ready'; drafts: DraftRecord[] }

/** This actor's drafts, kept in step with the other tabs over the drafts channel. */
export const DraftsList: FC<Props> = ({
  host,
  profile,
  currentTime,
  isMediaUploadEnabled
}) => {
  const actorId = profile.id
  const [state, setState] = useState<ListState>({ status: 'loading' })
  // A snapshot taken at Edit: the editor keeps it while saves rewrite the row.
  // A draft that vanishes (sent, deleted elsewhere) drops its row and editor.
  const [editing, setEditing] = useState<DraftRecord | null>(null)
  // Failed row deletes by draft id, shown above the list (never inside it).
  // Only that row's next delete clears its error.
  const [deleteErrors, setDeleteErrors] = useState<
    Record<string, { message: string; retry?: () => void }>
  >({})
  const loadToken = useRef(0)

  const load = useCallback(() => {
    const token = ++loadToken.current
    listDrafts({ actorId })
      .then((drafts) => {
        if (token !== loadToken.current) return
        setState({ status: 'ready', drafts })
      })
      .catch(() => {
        if (token === loadToken.current) setState({ status: 'unavailable' })
      })
  }, [actorId])

  useEffect(() => {
    load()
    const unsubscribe = subscribeDraftsMessages((message) => {
      if (message.type === 'changed' && message.actorId === actorId) load()
    })
    // Without BroadcastChannel, other tabs are only noticed on return.
    const onVisible = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      loadToken.current += 1
      unsubscribe()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [actorId, load])

  if (state.status === 'loading') return <SkeletonRows label="Loading drafts" />

  if (state.status === 'unavailable') {
    return (
      <Alert
        title="Couldn't open drafts on this device"
        onRetry={() => {
          setState({ status: 'loading' })
          load()
        }}
      >
        This browser isn't letting the site store drafts. Private browsing and
        blocked site data do that.
      </Alert>
    )
  }

  const { drafts } = state
  if (drafts.length === 0) {
    return (
      <EmptyState icon={FileText} titleAs="h2" title="No drafts.">
        Posts you save or can&apos;t send yet appear here.
      </EmptyState>
    )
  }

  return (
    <Section
      title="Drafts on this device"
      meta={`${drafts.length} ${drafts.length === 1 ? 'draft' : 'drafts'}`}
    >
      {drafts.map((draft) => {
        // A draft that vanished takes its error with it.
        const error = deleteErrors[draft.id]
        return error ? (
          <Alert
            key={draft.id}
            title="Couldn't delete draft"
            onRetry={error.retry}
          >
            {error.message}
          </Alert>
        ) : null
      })}
      <FramedList>
        {drafts.map((draft) => (
          <FramedListItem key={draft.id}>
            {editing?.id === draft.id ? (
              <DraftEditor
                draft={editing}
                host={host}
                profile={profile}
                isMediaUploadEnabled={isMediaUploadEnabled}
                onClose={() => {
                  setEditing(null)
                  load()
                }}
              />
            ) : (
              <DraftRow
                draft={draft}
                currentTime={currentTime}
                onEdit={() => setEditing(draft)}
                onConflict={load}
                onDeleteError={(message, retry) =>
                  setDeleteErrors(({ [draft.id]: _, ...rest }) =>
                    message ? { ...rest, [draft.id]: { message, retry } } : rest
                  )
                }
              />
            )}
          </FramedListItem>
        ))}
      </FramedList>
    </Section>
  )
}
