'use client'

import { FileText } from 'lucide-react'
import { FC, useCallback, useEffect, useRef, useState } from 'react'

import {
  DraftBusyError,
  type DraftRecord,
  announceDraftsChanged,
  listDrafts,
  subscribeDraftsMessages,
  unqueueDraft
} from '@/lib/client/drafts'
import { holdsQueue } from '@/lib/client/drafts/queueConstants'
import { Alert } from '@/lib/components/surface/Alert'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { FramedList, FramedListItem } from '@/lib/components/surface/FramedList'
import { Section } from '@/lib/components/surface/Section'
import { SkeletonRows } from '@/lib/components/surface/Skeleton'
import { ActorProfile } from '@/lib/types/domain/actor'

import { DraftEditor } from './DraftEditor'
import { DraftRow } from './DraftRow'
import { useSendQueueStatus } from './DraftsProvider'

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
  // The draft Edit found being sent, and a failed Edit or Resume: both shown
  // above the list. The busy notice goes once that draft is no longer in
  // flight, so it never outlives the send.
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const loadToken = useRef(0)
  const queue = useSendQueueStatus()

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

  // Edit and Review on a queued post take it out of the queue first. The
  // editor opens on the record that comes back (a new revision), and the
  // post then lives under "Drafts on this device".
  const onEdit = async (draft: DraftRecord) => {
    if (!draft.queue) {
      setEditing(draft)
      return
    }
    try {
      const unqueued = await unqueueDraft(draft.id)
      if (!unqueued) {
        // Gone since the list was read (sent, or deleted elsewhere).
        load()
        return
      }
      setBusyId(null)
      setActionError(null)
      setEditing(unqueued)
      announceDraftsChanged(draft.accountId, draft.actorId, draft.id)
    } catch (error) {
      if (error instanceof DraftBusyError) setBusyId(draft.id)
      else setActionError('Something went wrong on this device. Try again.')
      load()
    }
  }

  const isBusy = drafts.some(
    (draft) =>
      draft.id === busyId &&
      (draft.queue?.state === 'sending' || draft.queue?.state === 'checking')
  )
  // The post being edited stays in the list it was opened from until the
  // re-read moves it, so its editor is not remounted.
  const queued = drafts
    .filter((draft) => draft.queue && editing?.id !== draft.id)
    .sort((a, b) => (a.queue?.queuedAt ?? 0) - (b.queue?.queuedAt ?? 0))
  const plain = drafts.filter((draft) => !queued.includes(draft))
  // A 401 or profile switch holds every other queued post too, until reload.
  const heldBy = queued.find((draft) => holdsQueue(draft.queue))?.queue
    ?.pausedBy

  if (drafts.length === 0) {
    return (
      <EmptyState icon={FileText} titleAs="h2" title="No drafts.">
        Posts you save or can&apos;t send yet appear here.
      </EmptyState>
    )
  }

  const renderRows = (rows: DraftRecord[]) => (
    <>
      {rows.map((draft) => {
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
        {rows.map((draft) => (
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
                onEdit={() => void onEdit(draft)}
                onConflict={load}
                onActionError={setActionError}
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
    </>
  )

  return (
    <div className="space-y-6">
      {isBusy ? (
        <Alert tone="info" title="This post is being sent now." />
      ) : null}
      {queue?.drainFailed && queued.length > 0 ? (
        <Alert title="Couldn't send queued posts" onRetry={queue.retry}>
          Something went wrong on this device.
        </Alert>
      ) : null}
      {actionError ? (
        <Alert title="Couldn't update this post">{actionError}</Alert>
      ) : null}
      {heldBy ? (
        <Alert tone="info" title="Sending is paused">
          {heldBy === 'auth'
            ? 'Sign in again, and the rest of the queue sends after that.'
            : 'Another tab switched profile. Switch back to this one, then reload, and the rest of the queue sends.'}
        </Alert>
      ) : null}
      {queued.length > 0 ? (
        <Section
          title="Waiting to send"
          meta={`${queued.length} ${queued.length === 1 ? 'post' : 'posts'}`}
        >
          {renderRows(queued)}
        </Section>
      ) : null}
      {plain.length > 0 ? (
        <Section
          title="Drafts on this device"
          meta={`${plain.length} ${plain.length === 1 ? 'draft' : 'drafts'}`}
        >
          {renderRows(plain)}
        </Section>
      ) : null}
    </div>
  )
}
