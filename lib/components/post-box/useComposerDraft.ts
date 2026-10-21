'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import type {
  DraftAttachment,
  DraftFitnessFile,
  DraftPoll,
  DraftRecord
} from '@/lib/client/drafts'
import { postDraftsMessage } from '@/lib/client/drafts/draftsChannel'
import {
  DraftConflictError,
  DraftSignedOutError,
  DraftsUnavailableError
} from '@/lib/client/drafts/errors'
import { requestPersistentOfflineStorage } from '@/lib/client/offline'
import {
  type DraftsContextValue,
  useDrafts
} from '@/lib/components/drafts/DraftsProvider'
import type { QuoteApprovalPolicy, Status } from '@/lib/types/domain/status'
import { cleanJson } from '@/lib/utils/cleanJson'
import type { MastodonVisibility } from '@/lib/utils/getVisibility'
import { generatePublicId } from '@/lib/utils/publicId'

// The IndexedDB code loads on first use (DraftsProvider asks for it right after
// mount), so it stays out of every page's first-load JavaScript.
const loadDrafts = () => import('@/lib/client/drafts')

export const DRAFT_SAVE_DEBOUNCE_MS = 800

export type DraftSaveState = 'idle' | 'saving' | 'saved' | 'error'

/** What a composer hands the hook: the draft's content, not its bookkeeping. */
export interface DraftContent {
  text: string
  contentWarning: string
  contentWarningVisible: boolean
  visibility: MastodonVisibility
  quoteApprovalPolicy: QuoteApprovalPolicy
  language?: string
  poll?: DraftPoll
  attachments: Omit<DraftAttachment, 'hasBlob'>[]
  fitnessFile?: Omit<DraftFitnessFile, 'hasBlob'>
}

export interface SubmitCheckpoint {
  key: string
  fingerprint: string
}

interface Options {
  composer: DraftRecord['composer']
  /** An edit of a published post is never autosaved. */
  editing?: boolean
  replyTo?: Status
  quoteOf?: Status
  /** The draft this composer reopened: the hook continues its revisions. */
  draft?: DraftRecord
  /**
   * Set by the Drafts page editor: emptying the composer keeps the saved
   * record (an empty save), so selecting all text to retype it loses nothing.
   * The record is deleted only when the composer unmounts with nothing worth
   * keeping.
   */
  keepWhenEmpty?: boolean
  /**
   * True while a reopened draft is only partly restored (its attachment bytes
   * are still loading). Nothing is saved or discarded meanwhile: the composer
   * would otherwise write a record without the attachments.
   */
  isSeeding?: () => boolean
  /**
   * The composer's current content, or null when there is nothing worth
   * keeping. `force` asks for the content even when it is not draft-worthy
   * (a create attempt or a lock must be persisted whatever it holds). It reads
   * refs, so a poll choice typed into an uncontrolled input is included.
   */
  getContent: (force?: boolean) => DraftContent | null
}

// Everything that belongs to one draft. Replaced wholesale when the composer
// moves on (release, discard, detach), so a save still queued for the old draft
// keeps writing to the old one.
interface DraftState {
  id: string | null
  revision: number
  createdAt: number
  blobIds: Set<string>
  blobFailures: Set<string>
  lastKey: string
  /** Saves queued or running for this draft. */
  pending: number
  conflicted: boolean
  settled: boolean
  submit?: SubmitCheckpoint
  lockedMessage?: string
  attemptedAt?: number
  lastError: unknown
}

const newDraftState = (): DraftState => ({
  id: null,
  revision: 0,
  createdAt: 0,
  blobIds: new Set(),
  blobFailures: new Set(),
  lastKey: '',
  pending: 0,
  conflicted: false,
  settled: false,
  lastError: null
})

const recordKey = (record: DraftRecord): string => {
  const { revision: _revision, updatedAt: _updatedAt, ...rest } = record
  return JSON.stringify(rest)
}

const stateFromDraft = (draft: DraftRecord): DraftState => ({
  ...newDraftState(),
  id: draft.id,
  revision: draft.revision,
  createdAt: draft.createdAt,
  blobIds: new Set([
    ...draft.attachments.filter((a) => a.hasBlob).map((a) => a.localId),
    ...(draft.fitnessFile?.hasBlob ? [draft.fitnessFile.localId] : [])
  ]),
  lastKey: recordKey(draft),
  submit: draft.submit,
  lockedMessage: draft.lockedMessage,
  attemptedAt: draft.attemptedAt
})

interface Snapshot {
  d: DraftState
  content: DraftContent | null
  ctx: DraftsContextValue
  composer: DraftRecord['composer']
  replyTo?: Status
  quoteOf?: Status
  // Read at capture time: a composer that moves on right after must not
  // change what this save writes.
  submit?: SubmitCheckpoint
  lockedMessage?: string
  attemptedAt?: number
}

let persistRequested = false

const assemble = (snap: Snapshot, content: DraftContent): DraftRecord => ({
  id: snap.d.id as string,
  accountId: snap.ctx.accountId,
  actorId: snap.ctx.actorId,
  revision: snap.d.revision,
  createdAt: snap.d.createdAt,
  updatedAt: snap.d.createdAt,
  composer: snap.composer,
  text: content.text,
  contentWarning: content.contentWarning,
  contentWarningVisible: content.contentWarningVisible,
  visibility: content.visibility,
  quoteApprovalPolicy: content.quoteApprovalPolicy,
  language: content.language,
  replyTo: snap.replyTo,
  quoteOf: snap.quoteOf,
  poll: content.poll,
  attachments: content.attachments.map((attachment) => ({
    ...attachment,
    hasBlob: snap.d.blobIds.has(attachment.localId)
  })),
  fitnessFile: content.fitnessFile
    ? {
        ...content.fitnessFile,
        hasBlob: snap.d.blobIds.has(content.fitnessFile.localId)
      }
    : undefined,
  attemptedAt: snap.attemptedAt,
  submit: snap.submit,
  lockedMessage: snap.lockedMessage
})

/**
 * Rebuilds the `File`s a reopened draft still holds bytes for, by `localId`.
 * Tries every attachment without an upload id (and the fitness file) whatever
 * `hasBlob` says: a blob can land after the record that would flag it.
 */
export const loadDraftFiles = async (
  draft: DraftRecord
): Promise<
  Map<string, { file: File; posterFile?: File; mimeType: string }>
> => {
  const wanted = [
    ...draft.attachments.filter((a) => !a.mediaId).map((a) => a.localId),
    ...(draft.fitnessFile ? [draft.fitnessFile.localId] : [])
  ]
  const files = new Map<
    string,
    { file: File; posterFile?: File; mimeType: string }
  >()
  await Promise.all(
    wanted.map(async (localId) => {
      try {
        const { getDraftBlob, blobRecordToFile, blobRecordToPosterFile } =
          await loadDrafts()
        const blob = await getDraftBlob(localId)
        if (!blob || blob.draftId !== draft.id) return
        files.set(localId, {
          file: blobRecordToFile(blob),
          posterFile: blobRecordToPosterFile(blob),
          mimeType: blob.mimeType
        })
      } catch {
        // Unreadable bytes: the composer drops that attachment.
      }
    })
  )
  return files
}

/**
 * Autosaves a composer's content as an on-device draft. Every method is a
 * no-op while `useDrafts()` is null (no provider), while editing a published
 * post, and while another tab signs the account out.
 */
export const useComposerDraft = ({
  composer,
  editing = false,
  replyTo,
  quoteOf,
  draft,
  keepWhenEmpty = false,
  isSeeding,
  getContent
}: Options) => {
  const drafts = useDrafts()
  const enabled = drafts !== null && !editing && !drafts.signingOut
  const [saveState, setSaveStateValue] = useState<DraftSaveState>('idle')
  // Set once a save has landed: the id of a draft that exists on this device.
  const [draftId, setDraftId] = useState<string | null>(
    draft && draft.revision > 0 ? draft.id : null
  )

  const live = useRef({
    enabled,
    drafts,
    composer,
    replyTo,
    quoteOf,
    keepWhenEmpty,
    isSeeding,
    getContent
  })
  live.current = {
    enabled,
    drafts,
    composer,
    replyTo,
    quoteOf,
    keepWhenEmpty,
    isSeeding,
    getContent
  }

  // Status objects are large and a draft needs a JSON-safe copy of each once,
  // not per save.
  const snapshots = useRef<{
    replyTo?: { source: Status; copy: Status }
    quoteOf?: { source: Status; copy: Status }
  }>({})
  const copyOf = (key: 'replyTo' | 'quoteOf', source?: Status) => {
    if (!source) return undefined
    const cached = snapshots.current[key]
    if (cached?.source === source) return cached.copy
    const copy = cleanJson(source)
    snapshots.current[key] = { source, copy }
    return copy
  }

  const store = useRef<{
    d: DraftState
    timer: ReturnType<typeof setTimeout> | undefined
    chain: Promise<unknown>
    status: DraftSaveState
    mounted: boolean
    // Blob writes refused for want of an epoch, run again once it resolves.
    blobRetries: Map<string, () => void>
  } | null>(null)
  if (!store.current) {
    store.current = {
      d: draft ? stateFromDraft(draft) : newDraftState(),
      timer: undefined,
      chain: Promise.resolve(),
      status: 'idle',
      mounted: true,
      blobRetries: new Map()
    }
  }
  const s = store.current

  const api = useMemo(() => {
    const setStatus = (d: DraftState, next: DraftSaveState) => {
      if (s.d !== d) return
      s.status = next
      if (s.mounted) setSaveStateValue(next)
    }

    const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
      const run = s.chain.then(fn)
      s.chain = run.then(
        () => undefined,
        () => undefined
      )
      return run
    }

    const clearTimer = () => {
      if (s.timer !== undefined) clearTimeout(s.timer)
      s.timer = undefined
    }

    const forget = () => {
      clearTimer()
      s.d = newDraftState()
      s.status = 'idle'
      if (s.mounted) {
        setSaveStateValue('idle')
        setDraftId(null)
      }
    }

    // Reads the content now: a save that runs later must write what the
    // composer held when it was asked, even if the composer is reset meanwhile.
    const capture = (force = false): Snapshot | null => {
      const { enabled: on, drafts: ctx } = live.current
      if (!on || !ctx || live.current.isSeeding?.()) return null
      const d = s.d
      // A saved record is kept empty while the editor is open.
      const content = live.current.getContent(
        force || (live.current.keepWhenEmpty && d.revision > 0)
      )
      // Minted at once, so `hasDraft()` is true as soon as content is kept.
      if (content && !d.id) {
        d.id = generatePublicId()
        d.createdAt = Date.now()
      }
      return {
        d,
        content,
        ctx,
        composer: live.current.composer,
        replyTo: copyOf('replyTo', live.current.replyTo),
        quoteOf: copyOf('quoteOf', live.current.quoteOf),
        submit: d.submit,
        lockedMessage: d.lockedMessage,
        attemptedAt: d.attemptedAt
      }
    }

    // The provider's epoch is the one this tab pinned at sign-in. Re-reading
    // it per save would let a tab that missed a sign-out write for the old
    // account, so nothing is saved until the provider has resolved it.
    const epochFor = (ctx: DraftsContextValue): number => {
      // A save queued before the epoch resolved sees the provider's value now.
      const latest = live.current.drafts
      const epoch =
        latest?.accountId === ctx.accountId ? latest.epoch : ctx.epoch
      if (epoch === null) {
        throw new DraftsUnavailableError('Drafts are not ready yet')
      }
      return epoch
    }

    const announceChanged = (snap: Snapshot) =>
      postDraftsMessage({
        type: 'changed',
        accountId: snap.ctx.accountId,
        actorId: snap.ctx.actorId,
        draftId: snap.d.id as string
      })

    const reconcileBlobs = (d: DraftState, record: DraftRecord) => {
      const referenced = new Set([
        ...record.attachments.map((a) => a.localId),
        ...(record.fitnessFile ? [record.fitnessFile.localId] : [])
      ])
      for (const id of [...d.blobIds]) {
        if (referenced.has(id)) continue
        d.blobIds.delete(id)
        void loadDrafts()
          .then((m) => m.deleteDraftBlob(id))
          .catch(() => undefined)
      }
      // A failed attachment the composer no longer holds is not a failure.
      for (const id of [...d.blobFailures]) {
        if (!referenced.has(id)) d.blobFailures.delete(id)
      }
    }

    // Serialized through the chain, so revisions never race each other.
    const runSave = async (snap: Snapshot): Promise<boolean> => {
      const { d, content } = snap
      if (d.conflicted) {
        d.lastError = new DraftConflictError()
        setStatus(d, 'error')
        return false
      }
      try {
        if (!content) {
          if (d.id && d.revision > 0) {
            await (await loadDrafts()).deleteDraft(d.id)
            announceChanged(snap)
          } else {
            // Never stored, so no record will ever reference these bytes.
            for (const id of d.blobIds) {
              void loadDrafts()
                .then((m) => m.deleteDraftBlob(id))
                .catch(() => undefined)
            }
          }
          d.blobIds.clear()
          d.blobFailures.clear()
          if (s.d === d) {
            // Empty: the draft is gone, the next content starts a new one.
            d.id = null
            d.revision = 0
            d.lastKey = ''
            setStatus(d, 'idle')
            if (s.mounted) setDraftId(null)
          }
          return true
        }
        const record = assemble(snap, content)
        const key = recordKey(record)
        if (d.revision > 0 && key === d.lastKey) {
          setStatus(d, d.blobFailures.size > 0 ? 'error' : 'saved')
          return true
        }
        setStatus(d, 'saving')
        const epoch = epochFor(snap.ctx)
        const saved = await (
          await loadDrafts()
        ).saveDraft(record, {
          expectedRevision: d.revision,
          epoch
        })
        d.revision = saved.revision
        d.lastKey = key
        d.lastError = null
        reconcileBlobs(d, record)
        if (s.d === d && s.mounted) setDraftId(saved.id)
        setStatus(d, d.blobFailures.size > 0 ? 'error' : 'saved')
        announceChanged(snap)
        if (!persistRequested) {
          persistRequested = true
          void requestPersistentOfflineStorage()
        }
        return true
      } catch (error) {
        // Another tab saved, deleted or signed out: stop, never overwrite.
        if (
          error instanceof DraftConflictError ||
          error instanceof DraftSignedOutError
        ) {
          d.conflicted = true
        }
        d.lastError = error
        setStatus(d, 'error')
        return false
      }
    }

    const queueSave = (snap: Snapshot): Promise<boolean> => {
      snap.d.pending += 1
      return enqueue(() => runSave(snap)).finally(() => {
        snap.d.pending -= 1
      })
    }

    const saveNow = (force = false): Promise<boolean> => {
      clearTimer()
      const snap = capture(force)
      if (!snap) return Promise.resolve(true)
      return queueSave(snap)
    }

    const schedule = () => {
      const { enabled: on } = live.current
      if (!on || s.d.settled || s.d.conflicted) return
      clearTimer()
      if (s.status !== 'error' && live.current.getContent() !== null) {
        setStatus(s.d, 'saving')
      }
      s.timer = setTimeout(() => {
        s.timer = undefined
        void saveNow()
      }, DRAFT_SAVE_DEBOUNCE_MS)
    }

    const flush = (): Promise<void> => {
      if (!live.current.enabled) return Promise.resolve()
      if (s.timer !== undefined) void saveNow()
      return s.chain.then(() => undefined)
    }

    // True only while a record is stored or a save is on its way: a draft whose
    // saves all failed holds nothing, so its uploaded media is not kept.
    const hasDraft = (): boolean =>
      live.current.enabled &&
      (s.d.revision > 0 ||
        s.d.pending > 0 ||
        (s.timer !== undefined && live.current.getContent() !== null))

    const attachBlob = (localId: string, file: File, poster?: File) => {
      if (!live.current.enabled || !live.current.drafts) return
      const ctx = live.current.drafts
      const d = s.d
      if (!d.id) {
        d.id = generatePublicId()
        d.createdAt = Date.now()
      }
      const draftIdForBlob = d.id
      const write = () =>
        void enqueue(async () => {
          // The composer moved on (posted, discarded): nothing owns these bytes.
          if (s.d !== d) return
          try {
            const { fileToBlobRecord, putDraftBlob } = await loadDrafts()
            const record = await fileToBlobRecord({
              id: localId,
              draftId: draftIdForBlob,
              file,
              poster
            })
            await putDraftBlob(record, {
              accountId: ctx.accountId,
              epoch: epochFor(ctx)
            })
            d.blobIds.add(localId)
            d.blobFailures.delete(localId)
            s.blobRetries.delete(localId)
          } catch (error) {
            if (live.current.drafts?.epoch === null) {
              s.blobRetries.set(localId, write)
            }
            // Never silent: the status line says the draft is not safe.
            d.blobFailures.add(localId)
            d.lastError = error
            setStatus(d, 'error')
          }
        }).then(() => {
          if (s.d === d) schedule()
        })
      write()
    }

    // The create attempt (and the key it uses) must be durable before the POST:
    // a lost response plus a lost key would send the same content again under a
    // new key. False means the checkpoint failed and the send must not happen.
    const recordAttempt = async (
      submit: SubmitCheckpoint
    ): Promise<boolean> => {
      if (!live.current.enabled) return true
      const d = s.d
      d.submit = submit
      d.attemptedAt ??= Date.now()
      const ok = await saveNow(true)
      if (ok) return true
      // Nothing was ever persisted and storage itself failed (private mode,
      // quota): there is no older draft a reload could resurrect, so sending
      // is safe. A conflict, a sign-out or an older revision must block.
      const error = d.lastError
      const blocking =
        error instanceof DraftConflictError ||
        error instanceof DraftSignedOutError ||
        d.revision > 0
      return !blocking
    }

    const recordLock = (
      message: string | null,
      submit: SubmitCheckpoint | null
    ): Promise<boolean> => {
      if (!live.current.enabled) return Promise.resolve(true)
      const d = s.d
      d.lockedMessage = message ?? undefined
      d.submit = submit ?? undefined
      if (message) d.attemptedAt ??= Date.now()
      return saveNow(true)
    }

    const release = (): Promise<void> => {
      if (!live.current.enabled) return Promise.resolve()
      const d = s.d
      const ctx = live.current.drafts
      forget()
      return enqueue(async () => {
        if (!d.id || d.revision === 0) return
        try {
          await (await loadDrafts()).deleteDraft(d.id)
          if (ctx) {
            postDraftsMessage({
              type: 'changed',
              accountId: ctx.accountId,
              actorId: ctx.actorId,
              draftId: d.id
            })
          }
        } catch {
          // Reopening it later replays under the same key: no duplicate.
        }
      })
    }

    const discard = (): Promise<void> => {
      const snap = capture(true)
      if (!snap) return Promise.resolve()
      forget()
      return enqueue(async () => {
        const { d, content } = snap
        if (!d.id) return
        try {
          if (content) {
            const drafts = await loadDrafts()
            await drafts.deleteDraftAndOwnedMedia(assemble(snap, content))
          } else {
            await (await loadDrafts()).deleteDraft(d.id)
          }
          announceChanged(snap)
        } catch {
          // Nothing more to do: the record may stay and the Drafts page can
          // delete it.
        }
      })
    }

    // Saves what the composer holds, then lets it move on to new content
    // without touching the saved draft.
    const detach = (): Promise<void> => {
      if (!live.current.enabled) return Promise.resolve()
      const snap = capture()
      forget()
      if (!snap) return Promise.resolve()
      return queueSave(snap).then(() => undefined)
    }

    // Closing with content: the draft stays, and the composer stops saving.
    const keep = async (): Promise<boolean> => {
      if (!live.current.enabled) return false
      const d = s.d
      const ctx = live.current.drafts
      await saveNow(true)
      if (
        !d.id ||
        d.revision === 0 ||
        d.conflicted ||
        d.lastError ||
        d.blobFailures.size > 0
      ) {
        return false
      }
      d.settled = true
      ctx?.notifySavedToDrafts(d.id)
      return true
    }

    // Unmount of a Drafts-page editor (Close or navigating away): a saved
    // draft with nothing worth keeping is deleted; anything else is flushed.
    // A conflict (another tab edited it) keeps the record.
    const settleOnUnmount = (): Promise<void> => {
      const d = s.d
      if (
        live.current.keepWhenEmpty &&
        live.current.enabled &&
        !d.settled &&
        d.id &&
        d.revision > 0 &&
        !live.current.isSeeding?.() &&
        live.current.getContent() === null
      ) {
        // React StrictMode unmounts and remounts at once in development:
        // only discard if the composer is still gone a tick later.
        setTimeout(() => {
          if (!s.mounted) void discard()
        }, 0)
        return Promise.resolve()
      }
      return flush()
    }

    return {
      settleOnUnmount,
      schedule,
      flush,
      hasDraft,
      attachBlob,
      recordAttempt,
      recordLock,
      release,
      discard,
      detach,
      keep,
      clearTimer
    }
  }, [s])

  // Another tab (or the browser) may go away at any moment: save when hidden.
  useEffect(() => {
    s.mounted = true
    const onHide = () => {
      if (document.visibilityState === 'hidden') void api.flush()
    }
    const onPageHide = () => void api.flush()
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
      void api.settleOnUnmount()
      s.mounted = false
    }
  }, [api, s])

  // Signing out in another tab: drop the pending save (the epoch would abort
  // it anyway).
  useEffect(() => {
    if (!enabled) api.clearTimer()
  }, [enabled, api])

  // The provider's epoch resolving is what lets a refused save go through.
  const epoch = drafts?.epoch
  useEffect(() => {
    if (epoch === null || epoch === undefined) return
    const retries = [...s.blobRetries.values()]
    s.blobRetries.clear()
    retries.forEach((retry) => retry())
    if (s.status === 'error') api.schedule()
  }, [epoch, api, s])

  const { clearTimer: _clearTimer, ...methods } = api
  return { saveState, draftId, enabled, ...methods }
}
