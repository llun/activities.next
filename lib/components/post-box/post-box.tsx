import { Activity, Eye, X } from 'lucide-react'
import dynamic from 'next/dynamic'
import {
  FC,
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState
} from 'react'

import {
  createNote,
  createPoll,
  deleteUnpostedFitnessFile,
  deleteUnpostedMedia,
  getCustomEmojis,
  getDefaultQuotePolicy,
  getGallerySettings,
  getMedia,
  suggestMediaSubjects,
  updateNote,
  uploadAttachment,
  uploadFitnessFile
} from '@/lib/client'
import { reportRequestFailure } from '@/lib/client/connection'
import type { DraftRecord } from '@/lib/client/drafts'
import {
  DRAFT_LOCKED_NOTICE,
  classifyFailedPost,
  isPostKeptByServer
} from '@/lib/client/http'
import { DraftsLink } from '@/lib/components/drafts/DraftsLink'
import { useDrafts } from '@/lib/components/drafts/DraftsProvider'
import { useInstanceLimits } from '@/lib/components/instance-limits'
import type {
  MediaDetailsDialogItem,
  MediaDetailsSavedItem
} from '@/lib/components/media-details/media-details-dialog'
import { ContentWarning } from '@/lib/components/posts/content-warning'
import { Alert } from '@/lib/components/surface/Alert'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { Button } from '@/lib/components/ui/button'
import { useAutoResizeTextarea } from '@/lib/hooks/useAutoResizeTextarea'
import type { GallerySettingsEntity } from '@/lib/services/gallery/galleryEntities'
import type {
  MediaDetailsEntity,
  MediaStorageSaveFileOutput
} from '@/lib/services/medias/types'
import { Duration } from '@/lib/services/statuses/pollDurations'
import {
  ActorProfile,
  getMention,
  getMentionFromActorID
} from '@/lib/types/domain/actor'
import { Attachment, PostBoxAttachment } from '@/lib/types/domain/attachment'
import {
  EditableStatus,
  QuoteApprovalPolicy,
  Status,
  StatusNote,
  StatusType
} from '@/lib/types/domain/status'
import { Tag } from '@/lib/types/domain/tag'
import type { CustomEmoji } from '@/lib/types/mastodon/customEmoji'
import { cn } from '@/lib/utils'
import { formatFileSize } from '@/lib/utils/formatFileSize'
import { getVisibility } from '@/lib/utils/getVisibility'
import { generatePublicId } from '@/lib/utils/publicId'
import { cleanClassName } from '@/lib/utils/text/cleanClassName'
import { getEmojiTags } from '@/lib/utils/text/getEmojiTags'
import { processStatusTextContent } from '@/lib/utils/text/processStatusText'

import { DraftSaveStatus } from './DraftSaveStatus'
import {
  ComposerAttachmentTiles,
  getAttachmentLabel
} from './composer-attachment-tiles'
import {
  areAttachmentIdsEqualInOrder,
  getChangedAttachmentDescriptions,
  getEditableStatusAttachments,
  getStatusAttachmentsFromUpdateResponse,
  getTimestamp,
  shouldTakeEditedMedia
} from './composerAttachments'
import {
  isEditSubmittable as checkIsEditSubmittable,
  getEditableStatusText,
  hasNewPostContent,
  isWithinLengthLimit
} from './composerValidation'
import { EmojiPickerButton } from './emoji-picker-button'
import { FitnessFileInput, FitnessFileInputHandle } from './fitness-file-input'
import { PollChoices } from './poll-choices'
import { PostOptionsMenu } from './post-options-menu'
import { QuotedPreview } from './quoted-preview'
import {
  addAttachment,
  addPollChoice,
  createChoices,
  createDefaultState,
  loadExtension,
  removeFitnessFile,
  removePollChoice,
  resetExtension,
  setAttachments,
  setContentWarning,
  setContentWarningVisibility,
  setFitnessFile,
  setFitnessFileUploaded,
  setFitnessFileUploading,
  setPollDurationInSeconds,
  setPollType,
  setPollVisibility,
  setQuoteApprovalPolicy,
  setVisibility,
  statusExtensionReducer,
  updateAttachment
} from './reducers'
import { ReplyPreview } from './reply-preview'
import { UploadMediaButton } from './upload-media-button'
import {
  DRAFT_CONFLICT_SEND_NOTICE,
  DRAFT_NOT_SAVED_SEND_NOTICE,
  type DraftContent,
  fromDraftAttachment,
  loadDraftFiles,
  toDraftAttachment,
  useComposerDraft
} from './useComposerDraft'

// Only shown once a media's details are opened, so keep it (and its gallery
// dependencies) out of the initial bundle.
const MediaDetailsDialog = dynamic(
  () =>
    import('@/lib/components/media-details/media-details-dialog').then(
      (module) => module.MediaDetailsDialog
    ),
  { ssr: false }
)

// Subject suggestions are model calls: at most this many run at once per
// composer, the rest wait their turn.
const MAX_CONCURRENT_SUGGESTIONS = 2

interface Props {
  host: string
  profile: ActorProfile
  replyStatus?: Status
  editStatus?: EditableStatus
  quotedStatus?: Status
  isMediaUploadEnabled?: boolean
  /**
   * Photos to open the composer with: the owner's media added in Gallery that
   * no post uses yet ("Post" in Gallery). Taken once, by a new post's composer
   * (not a reply, quote or edit), up to the instance's attachment limit. They
   * are the owner's gallery photos, so abandoning the composer never deletes
   * them.
   */
  initialMedia?: PostBoxAttachment[]
  onDiscardReply: () => void
  onDiscardQuote?: () => void
  onPostCreated: (status: Status, attachments: Attachment[]) => void
  onPostUpdated: (status: Status) => void
  onDiscardEdit: () => void
  /** A saved draft to reopen: seeds the composer on its first run. */
  draft?: DraftRecord
  /** Drafts page only: an emptied draft stays saved until the editor closes. */
  keepWhenEmpty?: boolean
  /**
   * When set, the form is wrapped in a `<section>` with these classes and the
   * submit Alert renders after it, outside the framed card.
   */
  frameClassName?: string
  /** The home composer only: shows the "N drafts · Open" link. */
  showDraftsLink?: boolean
}

export const PostBox: FC<Props> = ({
  host,
  profile,
  replyStatus,
  editStatus,
  quotedStatus,
  isMediaUploadEnabled,
  initialMedia,
  onPostCreated,
  onPostUpdated,
  onDiscardReply,
  onDiscardQuote,
  onDiscardEdit,
  draft,
  keepWhenEmpty,
  frameClassName,
  showDraftsLink
}) => {
  // The instance's configured status length (admin setting `posts.maxCharacters`,
  // published by the (timeline) layout). Client-side UX only — the create/edit
  // routes enforce the same resolved limit server-side.
  const { maxStatusCharacters, maxPollOptions, maxMediaAttachments } =
    useInstanceLimits()
  const [allowPost, setAllowPost] = useState<boolean>(false)
  const [isPosting, setIsPosting] = useState<boolean>(false)
  const [showPreview, setShowPreview] = useState<boolean>(false)
  const [text, setText] = useState<string>('')
  const [warningMsg, setWarningMsg] = useState<string | null>(null)
  // A failed submit, shown as an Alert after the composer card.
  const [submitError, setSubmitError] = useState<{
    title: string
    message: string
    // False for a conflict: trying again can only block again.
    retryable: boolean
  } | null>(null)
  // Set once the server kept a create (503/409): the draft is locked so Post
  // retries the same payload under the same Idempotency-Key. Any edit would
  // mint a new key and strand the kept post (or duplicate it).
  const [lockedMessage, setLockedMessageState] = useState<string | null>(null)
  const draftLocked = lockedMessage !== null
  // Written with the lock, not after render: a media batch that settles
  // between the two must already see it.
  const draftLockedRef = useRef(draftLocked)
  const setLockedMessage = (message: string | null) => {
    draftLockedRef.current = message !== null
    setLockedMessageState(message)
  }
  // Bumped when the composer is re-targeted: a submit still in flight belongs
  // to the previous draft and must not lock the new one.
  const draftGenerationRef = useRef(0)
  const postBoxRef = useRef<HTMLTextAreaElement>(null)
  useAutoResizeTextarea(postBoxRef, text)
  const formRef = useRef<HTMLFormElement>(null)
  const textRef = useRef(text)
  const submitInFlightRef = useRef(false)
  const submitIdempotencyRef = useRef<{
    fingerprint: string
    key: string
  } | null>(null)
  // Ids of media that a create/update has already accepted. A parent may
  // unmount the composer from inside `onPostCreated`/`onPostUpdated` (after
  // which `submitInFlightRef` is already false again), so every discard path
  // skips these: media that was posted must never be deleted.
  const postedMediaIdsRef = useRef(new Set<string>())
  // Fitness files a saved-but-unsent post (503/409) still uses: clearing them
  // from the composer must not delete them on the server.
  const keptFitnessFileIdsRef = useRef(new Set<string>())
  const fitnessCleanupInFlightRef = useRef<{
    uploadedId: string
    promise: Promise<boolean>
  } | null>(null)

  const [postExtension, dispatch] = useReducer(
    statusExtensionReducer,
    undefined,
    createDefaultState
  )
  const postExtensionRef = useRef(postExtension)
  // Media ids that belong to the status being edited. They are the status's own
  // media, so abandoning the composer must never delete them.
  const originalMediaIdsRef = useRef<Set<string>>(new Set())
  // Media the composer opened with (`initialMedia`): the owner's gallery
  // photos, which abandoning the composer must not delete either.
  const keptMediaIdsRef = useRef<Set<string>>(new Set())
  const initialMediaTakenRef = useRef(false)
  // The photos seeded from `initialMedia`, and whether they have been drawn.
  const seededMediaRef = useRef<PostBoxAttachment[]>([])
  const seededMediaShownRef = useRef(false)
  const isMountedRef = useRef(true)
  // Media details live beside the attachments, keyed by media id, rather than
  // on PostBoxAttachment: that type is what the deprecated outbox route takes
  // (the composer sends only media ids, and on edit their descriptions), and
  // the details (subject, gear, place) are already saved on the media row by
  // the dialog.
  const [gallerySettings, setGallerySettings] =
    useState<GallerySettingsEntity | null>(null)
  const [detailsById, setDetailsById] = useState<
    Record<string, MediaDetailsEntity>
  >({})
  const [decorativeIds, setDecorativeIds] = useState<Record<string, true>>({})
  const [fileNames, setFileNames] = useState<Record<string, string>>({})
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({})
  // True once the lazy settings request has failed (and until a retry works).
  const [settingsFailed, setSettingsFailed] = useState(false)
  const [detailsPending, setDetailsPending] = useState<Record<string, true>>({})
  const [activeDetailsId, setActiveDetailsId] = useState<string | null>(null)
  // Ids whose subject suggestions are queued or being asked for. The tile says
  // "Reading details…" for them but stays openable.
  const [suggestionsPending, setSuggestionsPending] = useState<
    Record<string, true>
  >({})
  const uploadErrorsRef = useRef<Record<string, string>>({})
  // In-flight uploads by attachment id; submit waits on every one of them.
  const uploadsRef = useRef(new Map<string, Promise<void>>())
  const settingsPromiseRef = useRef<Promise<void> | null>(null)
  // The latest settings and decorative marks for the submit gate, which runs
  // after awaits and must not read the stale render closure.
  const gallerySettingsRef = useRef<GallerySettingsEntity | null>(null)
  const decorativeIdsRef = useRef<Record<string, true>>({})
  // Suggestion requests: ids already asked for (once each), the waiting line,
  // and how many are in flight (at most MAX_CONCURRENT_SUGGESTIONS).
  const suggestionRequestedRef = useRef<Set<string>>(new Set())
  const suggestionQueueRef = useRef<string[]>([])
  const suggestionsActiveRef = useRef(0)
  // Server media id -> the temporary id the tile was first rendered with, so
  // the tile's React key survives the id swap when its upload finishes (a new
  // key would remount the tile and drop focus from its Remove button).
  const [clientKeys, setClientKeys] = useState<Record<string, string>>({})
  // The actor's default quote policy (Mastodon posting:default:quote_policy),
  // fetched once and re-applied after each post so it stays sticky across the
  // resetExtension() that follows a successful create.
  const defaultQuotePolicyRef = useRef<QuoteApprovalPolicy>('public')

  // On-device draft. The pre-fill a reply starts with is not the author's
  // text, so it alone never makes a draft.
  const initialTextRef = useRef('')
  // Server media id -> the local id the draft knows the attachment by (the
  // temporary id it was first drawn with), kept synchronously for the draft.
  const localIdByIdRef = useRef(new Map<string, string>())
  const fitnessLocalIdRef = useRef<string | null>(null)
  const draftSeededRef = useRef(false)
  // Bumped when a reopened draft is put back, so `allowPost` is worked out
  // again from what the composer then holds.
  const [draftSeedVersion, setDraftSeedVersion] = useState(0)

  // True while a reopened draft's attachment bytes are loading.
  const draftSeedingRef = useRef(false)

  const getDraftContent = (force = false): DraftContent | null => {
    if (editStatus) return null
    const extension = postExtensionRef.current
    const value = textRef.current
    // Not owned: a gallery photo the composer opened with, or media a kept
    // post uses. Discarding the draft never deletes these.
    const owned = (id: string) =>
      !keptMediaIdsRef.current.has(id) && !postedMediaIdsRef.current.has(id)
    const attachments = extension.attachments.map((attachment) =>
      toDraftAttachment(attachment, {
        localIds: localIdByIdRef.current,
        isOwned: owned,
        fileName: fileNames[attachment.id],
        decorative: Boolean(decorativeIdsRef.current[attachment.id])
      })
    )
    const poll = extension.poll.showing
      ? {
          choices: extension.poll.choices.map((choice) => choice.text),
          durationInSeconds: extension.poll.durationInSeconds,
          pollType: extension.poll.pollType
        }
      : undefined
    const fitness = extension.fitnessFile
    if (fitness && !fitnessLocalIdRef.current) {
      fitnessLocalIdRef.current = generatePublicId()
    }
    const fitnessFile =
      fitness && fitnessLocalIdRef.current
        ? {
            localId: fitnessLocalIdRef.current,
            fileName: fitness.file.name,
            mimeType: fitness.file.type,
            size: fitness.file.size,
            fitnessFileId: fitness.uploadedId,
            owned: !(
              fitness.uploadedId &&
              keptFitnessFileIdsRef.current.has(fitness.uploadedId)
            )
          }
        : undefined
    const worthKeeping =
      (value.trim() !== '' && value !== initialTextRef.current) ||
      extension.contentWarning.trim() !== '' ||
      attachments.some((attachment) => attachment.owned) ||
      Boolean(poll?.choices.some((choice) => choice.trim() !== '')) ||
      Boolean(fitnessFile)
    // A locked draft stays until it is discarded, whatever it holds.
    if (!worthKeeping && !force && !draftLockedRef.current) return null
    return {
      text: value,
      contentWarning: extension.contentWarning,
      contentWarningVisible: extension.contentWarningVisible,
      visibility: extension.visibility,
      quoteApprovalPolicy: extension.quoteApprovalPolicy,
      poll,
      attachments,
      fitnessFile
    }
  }

  const composerDraft = useComposerDraft({
    composer: 'post-box',
    editing: Boolean(editStatus),
    replyTo: replyStatus,
    quoteOf: quotedStatus,
    draft,
    keepWhenEmpty,
    isSeeding: () => draftSeedingRef.current,
    getContent: getDraftContent,
    // The draft this composer let go of keeps its key; new content gets its own.
    onUnlock: () => {
      submitIdempotencyRef.current = null
      // The block belonged to the draft this composer let go of.
      setSubmitError(null)
    }
  })
  const drafts = useDrafts()

  useEffect(() => {
    postExtensionRef.current = postExtension
    if (
      postExtension.attachments.some((attachment) =>
        keptMediaIdsRef.current.has(attachment.id)
      )
    ) {
      seededMediaShownRef.current = true
    }
  }, [postExtension])

  useEffect(() => {
    let active = true
    getDefaultQuotePolicy().then((policy) => {
      if (!active) return
      defaultQuotePolicyRef.current = policy
      // A reopened draft keeps the policy it was written with.
      if (!draft) dispatch(setQuoteApprovalPolicy(policy))
    })
    return () => {
      active = false
    }
  }, [])

  // Quote and poll are mutually exclusive (a quote post cannot carry a poll).
  // If a poll is open when a quote is started, close it so the poll create
  // branch can never run with a quote (which would drop the quote and leak the
  // quoted status onto the next post).
  useEffect(() => {
    if (quotedStatus && postExtensionRef.current.poll.showing) {
      dispatch(setPollVisibility(false))
    }
  }, [quotedStatus])

  useEffect(() => {
    textRef.current = text
  }, [text])

  // Autosave. Poll choices are uncontrolled inputs that write into their
  // Choice objects, so typing in one never renders: the form's onInput covers it.
  useEffect(() => {
    composerDraft.schedule()
    // schedule is stable and reads the composer through refs.
  }, [text, postExtension, decorativeIds, fileNames, lockedMessage])

  const [customEmojis, setCustomEmojis] = useState<CustomEmoji[]>([])
  useEffect(() => {
    let active = true
    getCustomEmojis().then((emojis) => {
      if (active) setCustomEmojis(emojis)
    })
    return () => {
      active = false
    }
  }, [])

  // Synthesizes emoji domain tags from the shortcodes present in the draft text
  // so the live preview renders custom emoji through the exact same
  // convertEmojisToImages pipeline the rendered Post uses. The synthetic ids are
  // preview-only and never persisted.
  const buildSyntheticEmojiTags = useCallback(
    (value: string | string[]): Tag[] => {
      const textToScan = Array.isArray(value) ? value.join(' ') : value
      return getEmojiTags(textToScan, customEmojis).map((emojiTag, index) => ({
        id: `preview-${index}`,
        statusId: 'preview',
        type: 'emoji' as const,
        name: emojiTag.name,
        value: emojiTag.value,
        createdAt: 0,
        updatedAt: 0
      }))
    },
    [customEmojis]
  )

  // Inserts text at the caret of the message textarea (used by the emoji/sticker
  // picker). Falls back to appending when the textarea ref is unavailable.
  const insertAtCaret = (snippet: string) => {
    const textarea = postBoxRef.current
    const current = textRef.current
    if (!textarea) {
      onTextChange(`${current}${snippet}`)
      return
    }
    const start = textarea.selectionStart ?? current.length
    const end = textarea.selectionEnd ?? current.length
    const next = current.slice(0, start) + snippet + current.slice(end)
    onTextChange(next)
    const caret = start + snippet.length
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(caret, caret)
    })
  }

  const isEditSubmittable = (
    value = textRef.current,
    extension = postExtensionRef.current
  ) =>
    checkIsEditSubmittable({
      editStatus,
      value,
      contentWarning: extension.contentWarning,
      contentWarningVisible: extension.contentWarningVisible,
      attachments: extension.attachments,
      maxLength: maxStatusCharacters
    })

  // `allowPost` is otherwise only recomputed by the handlers below, so a limit
  // that changes under an open draft (the layout re-renders on
  // router.refresh()) would leave a stale submit button — enabled for a draft
  // the server will now reject, whose click then hits the guard in `onPost` and
  // silently does nothing. Skipped while a submit is in flight so it can never
  // re-enable the button mid-post.
  useEffect(() => {
    if (isPosting) return
    if (editStatus) {
      setAllowPost(isEditSubmittable())
      return
    }
    // A locked draft is already saved on the server and replays before any
    // content-limit check, so a limit lowered since it locked must not block
    // its retry (the text is read-only; Discard would leave the post unsent).
    setAllowPost(
      draftLocked ||
        hasNewPostContent(
          textRef.current,
          postExtensionRef.current,
          maxStatusCharacters
        )
    )
    // Deliberately keyed only on the limit, the in-flight flag, the edit target
    // (to pick the predicate) and the draft lock: the draft itself is read from
    // refs, and every draft edit already recomputes `allowPost` in its handler.
  }, [
    maxStatusCharacters,
    isPosting,
    editStatus,
    draftLocked,
    draftSeedVersion
  ])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      // A saved draft owns its media: keeping it wins over deleting it.
      const draftOwnsMedia = composerDraft.hasDraft()
      void composerDraft.flush()
      // Uploads happen on attach, so media still in the composer when it goes
      // away was never posted: delete it (unless a submit is using it, or a
      // draft keeps it).
      if (!submitInFlightRef.current && !draftOwnsMedia) {
        discardUploadedMedia(postExtensionRef.current.attachments)
      }
      postExtensionRef.current.attachments.forEach((attachment) => {
        if (attachment.url.startsWith('blob:')) {
          URL.revokeObjectURL(attachment.url)
        }
        if (attachment.posterUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(attachment.posterUrl)
        }
      })
    }
  }, [])

  // Best-effort delete of media that was uploaded on attach but never posted.
  // Attachments still holding a file have no server copy yet, and the original
  // attachments of a status being edited are never deleted. The server refuses
  // (422) media a post uses, e.g. one another tab sent this draft as.
  function discardUploadedMedia(attachments: PostBoxAttachment[]) {
    attachments.forEach((attachment) => {
      if (attachment.file || attachment.isLoading) return
      if (originalMediaIdsRef.current.has(attachment.id)) return
      if (keptMediaIdsRef.current.has(attachment.id)) return
      if (postedMediaIdsRef.current.has(attachment.id)) return
      const del = () => deleteUnpostedMedia(attachment.id)
      // One the stored draft holds waits for the next save (useComposerDraft).
      if (composerDraft.deferServerDelete(attachment.id, del)) return
      del().catch(() => undefined)
    })
  }

  const markAttachmentsPosted = (attachments: PostBoxAttachment[]) => {
    attachments.forEach((attachment) =>
      postedMediaIdsRef.current.add(attachment.id)
    )
  }

  const revokeAttachmentUrls = (
    attachment: Pick<PostBoxAttachment, 'url' | 'posterUrl'>
  ) => {
    if (attachment.url.startsWith('blob:')) {
      URL.revokeObjectURL(attachment.url)
    }
    if (attachment.posterUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(attachment.posterUrl)
    }
  }

  const findAttachment = (id: string) =>
    postExtensionRef.current.attachments.find((item) => item.id === id)

  const replaceAttachment = (id: string, next: PostBoxAttachment) => {
    postExtensionRef.current = {
      ...postExtensionRef.current,
      attachments: postExtensionRef.current.attachments.map((item) =>
        item.id === id ? next : item
      )
    }
    dispatch(updateAttachment(id, next))
  }

  const setUploadError = (id: string, message: string | null) => {
    const { [id]: _removed, ...rest } = uploadErrorsRef.current
    uploadErrorsRef.current =
      message === null ? rest : { ...rest, [id]: message }
    setUploadErrors(uploadErrorsRef.current)
  }

  // The gallery settings are only needed once the composer holds media, so they
  // are requested lazily, once, the first time an attachment appears.
  const ensureGallerySettings = () => {
    if (!settingsPromiseRef.current) {
      settingsPromiseRef.current = getGallerySettings()
        .then((settings) => {
          setSettingsFailed(false)
          gallerySettingsRef.current = settings
          setGallerySettings(settings)
        })
        .catch(() => {
          // Without settings the composer fails open (no description
          // requirement, no Regenerate): the server does not enforce the
          // requirement, so a settings outage must not block posting. While
          // the request is still in flight Post is disabled instead (see
          // `settingsLoading`). Allow a later retry.
          setSettingsFailed(true)
          settingsPromiseRef.current = null
        })
    }
    return settingsPromiseRef.current
  }

  const hasAttachments = postExtension.attachments.length > 0
  useEffect(() => {
    if (hasAttachments) void ensureGallerySettings()
    // ensureGallerySettings only touches refs and a state setter.
  }, [hasAttachments])

  const applyMedia = (id: string, media: MediaStorageSaveFileOutput) => {
    const { details } = media
    if (details) setDetailsById((current) => ({ ...current, [id]: details }))
    // An attachment of the status being edited keeps its own name: the media
    // row's description may be empty while the attachment carries alt text, and
    // only an explicit save in the dialog may change it.
    if (originalMediaIdsRef.current.has(id)) return
    const current = findAttachment(id)
    if (current) {
      replaceAttachment(id, { ...current, name: media.description ?? '' })
    }
  }

  // Ids whose details were fetched successfully (the answer may legitimately
  // be "no details"), and fetches currently running. Neither is re-requested.
  const fetchedDetailsRef = useRef<Set<string>>(new Set())
  const detailsInFlightRef = useRef<Map<string, Promise<void>>>(new Map())
  // Bumped per id whenever the dialog saves it, so a details read that started
  // earlier cannot overwrite what the user just saved.
  const savedGenerationRef = useRef<Map<string, number>>(new Map())
  // The tile that opened the dialog, so focus can go back to it on close.
  const detailsOpenerIdRef = useRef<string | null>(null)

  // `silent` skips the tile's busy state: a details refetch triggered by
  // opening the dialog must not disable the tile that has focus.
  const loadDetails = (id: string, { silent = false } = {}) => {
    if (fetchedDetailsRef.current.has(id)) return Promise.resolve()
    const running = detailsInFlightRef.current.get(id)
    if (running) return running
    if (!silent) setDetailsPending((current) => ({ ...current, [id]: true }))
    const promise = (async () => {
      try {
        const generation = savedGenerationRef.current.get(id) ?? 0
        const media = await getMedia(id)
        // Saved (or edited) in the dialog while this read was in flight: the
        // read is stale, so keep what the user saved.
        if ((savedGenerationRef.current.get(id) ?? 0) === generation) {
          applyMedia(id, media)
        }
        fetchedDetailsRef.current.add(id)
      } catch {
        // The tile simply shows the state it has; opening the dialog retries.
      } finally {
        detailsInFlightRef.current.delete(id)
        if (!silent) {
          setDetailsPending((current) => {
            const { [id]: _done, ...rest } = current
            return rest
          })
        }
      }
    })()
    detailsInFlightRef.current.set(id, promise)
    return promise
  }

  const settleSuggestion = (id: string) => {
    if (!isMountedRef.current) return
    setSuggestionsPending((current) => {
      const { [id]: _done, ...rest } = current
      return rest
    })
  }

  const runSuggestion = async (id: string) => {
    try {
      if (!isMountedRef.current || !findAttachment(id)) return
      const suggestions = await suggestMediaSubjects(id)
      if (!isMountedRef.current) return
      // Only the suggestions: anything the author saved meanwhile stays.
      setDetailsById((current) =>
        current[id]
          ? {
              ...current,
              [id]: { ...current[id], subjectSuggestions: suggestions }
            }
          : current
      )
    } catch {
      // Suggestions are an aid: the tile simply has none, and the dialog can
      // ask again.
    } finally {
      settleSuggestion(id)
    }
  }

  const pumpSuggestions = () => {
    while (
      suggestionsActiveRef.current < MAX_CONCURRENT_SUGGESTIONS &&
      suggestionQueueRef.current.length > 0
    ) {
      const id = suggestionQueueRef.current.shift()
      if (!id) break
      suggestionsActiveRef.current += 1
      void runSuggestion(id).finally(() => {
        suggestionsActiveRef.current -= 1
        pumpSuggestions()
      })
    }
  }

  // After an upload finishes and its details are read: ask the instance's image
  // model for the subject, if the server and the author's setting allow it.
  // Never blocks posting; the media of a status being edited is left alone.
  const requestSuggestions = async (id: string) => {
    if (
      suggestionRequestedRef.current.has(id) ||
      originalMediaIdsRef.current.has(id)
    ) {
      return
    }
    await ensureGallerySettings()
    const settings = gallerySettingsRef.current
    if (
      !settings?.subjectSuggestionsAvailable ||
      settings.subjectSuggestionMode !== 'model' ||
      !isMountedRef.current ||
      !findAttachment(id) ||
      suggestionRequestedRef.current.has(id)
    ) {
      return
    }
    suggestionRequestedRef.current.add(id)
    setSuggestionsPending((current) => ({ ...current, [id]: true }))
    suggestionQueueRef.current.push(id)
    pumpSuggestions()
  }

  // Uploads when the file is attached rather than at Post: the tile shows the
  // progress, the server reads the file's details, and Post only has to wait
  // for whatever is still in flight.
  const startUpload = (attachment: PostBoxAttachment) => {
    const { file, posterFile } = attachment
    if (!file) return
    const tempId = attachment.id
    void ensureGallerySettings()
    setFileNames((current) => ({ ...current, [tempId]: file.name }))
    setUploadError(tempId, null)
    replaceAttachment(tempId, { ...attachment, isLoading: true })

    const run = async () => {
      try {
        const uploaded = posterFile
          ? await uploadAttachment(file, posterFile)
          : await uploadAttachment(file)
        if (!uploaded) throw new Error('The server rejected the upload')
        revokeAttachmentUrls(attachment)
        const current = findAttachment(tempId)
        // Removed (or the composer unmounted) while uploading: the server copy
        // is an orphan, so delete it (best effort) and leave no state behind.
        if (!current || !isMountedRef.current) {
          deleteUnpostedMedia(uploaded.id).catch(() => undefined)
          return
        }
        localIdByIdRef.current.set(
          uploaded.id,
          localIdByIdRef.current.get(tempId) ?? tempId
        )
        setClientKeys((keys) => ({
          ...keys,
          [uploaded.id]: keys[tempId] ?? tempId
        }))
        replaceAttachment(tempId, {
          ...current,
          ...uploaded,
          // Explicit: the revoked blob poster must not survive when the
          // server returns no poster.
          posterUrl: uploaded.posterUrl,
          isLoading: false,
          file: undefined,
          posterFile: undefined
        })
        setFileNames((names) => ({ ...names, [uploaded.id]: file.name }))
        await loadDetails(uploaded.id)
        void requestSuggestions(uploaded.id)
      } catch (error) {
        const current = findAttachment(tempId)
        // Removed while uploading: nothing to mark as failed.
        if (!current || !isMountedRef.current) return
        replaceAttachment(tempId, { ...current, isLoading: false })
        // Never store '': the tile treats a falsy error as "no error".
        setUploadError(
          tempId,
          error instanceof Error && error.message
            ? error.message
            : 'Upload failed'
        )
      }
    }
    const promise = run().finally(() => {
      if (uploadsRef.current.get(tempId) === promise) {
        uploadsRef.current.delete(tempId)
      }
    })
    uploadsRef.current.set(tempId, promise)
  }

  const uploadMediaAttachments = async () => {
    // Uploads start when media is attached; wait for the ones still running.
    await Promise.all(Array.from(uploadsRef.current.values()))

    const attachments = postExtensionRef.current.attachments
    attachments.forEach((attachment, index) => {
      if (!attachment.file) return
      const reason = uploadErrorsRef.current[attachment.id]
      throw new Error(
        `Fail to upload ${getAttachmentLabel(attachment, fileNames, index)}${reason ? `: ${reason}` : ''}`
      )
    })
    return attachments
  }

  const openDetails = async (id: string) => {
    // The post is about to use this media; nothing may change it mid-submit.
    if (isPosting || submitInFlightRef.current) return
    const missing = postExtensionRef.current.attachments.filter(
      (item) =>
        !item.file &&
        !item.isLoading &&
        !detailsById[item.id] &&
        !fetchedDetailsRef.current.has(item.id) &&
        !detailsInFlightRef.current.has(item.id)
    )
    await Promise.all([
      ensureGallerySettings(),
      ...missing.map((item) => loadDetails(item.id, { silent: true }))
    ])
    // The awaits above leave a window: a submit may have started, or the
    // attachment may have been removed or replaced (poll, fitness file).
    if (
      !isMountedRef.current ||
      submitInFlightRef.current ||
      !findAttachment(id)
    ) {
      return
    }
    detailsOpenerIdRef.current = id
    setActiveDetailsId(id)
  }

  const closeDetails = () => {
    const openerId = detailsOpenerIdRef.current
    setActiveDetailsId(null)
    if (!openerId) return
    // After the dialog has unmounted (and Radix has run its own focus return).
    setTimeout(() => {
      document
        .querySelector<HTMLElement>(
          `[data-attachment-tile="${CSS.escape(openerId)}"]`
        )
        ?.focus()
    }, 0)
  }

  // The photo editor saved or reverted an attachment: the composer takes over
  // its new file (url, size) and the details that came with it.
  const onMediaEdited = (
    id: string,
    media: MediaStorageSaveFileOutput,
    posts: { updated: string[] }
  ) => {
    const current = findAttachment(id)
    if (current && shouldTakeEditedMedia(editStatus, id, posts.updated)) {
      replaceAttachment(id, {
        ...current,
        url: media.url,
        mediaType: media.mime_type,
        width: media.meta.original.width,
        height: media.meta.original.height
      })
    }
    const edited = media.details
    if (edited) setDetailsById((all) => ({ ...all, [id]: edited }))
  }

  const onDetailsSaved = (saved: MediaDetailsSavedItem[]) => {
    saved.forEach((item) => {
      savedGenerationRef.current.set(
        item.id,
        (savedGenerationRef.current.get(item.id) ?? 0) + 1
      )
    })
    setDetailsById((current) => {
      const next = { ...current }
      saved.forEach((item) => {
        if (item.details) next[item.id] = item.details
      })
      return next
    })
    setDecorativeIds((current) => {
      const next = { ...current }
      saved.forEach((item) => {
        if (item.decorative) next[item.id] = true
        else delete next[item.id]
      })
      return next
    })
    saved.forEach((item) => {
      const current = findAttachment(item.id)
      if (current) {
        replaceAttachment(item.id, { ...current, name: item.description })
      }
    })
    // In edit mode a description-only change makes the draft dirty (the
    // description is sent as media_attributes on Update).
    // Not mid-submit: that would re-enable Update while the request is in flight.
    if (editStatus && !submitInFlightRef.current) {
      setAllowPost(isEditSubmittable())
    }
  }

  const resetMediaState = () => {
    suggestionRequestedRef.current.clear()
    suggestionQueueRef.current = []
    setSuggestionsPending({})
    uploadsRef.current.clear()
    fetchedDetailsRef.current.clear()
    detailsInFlightRef.current.clear()
    uploadErrorsRef.current = {}
    setUploadErrors({})
    setDetailsById({})
    setDecorativeIds({})
    setClientKeys({})
    setFileNames({})
    setDetailsPending({})
    setActiveDetailsId(null)
    localIdByIdRef.current.clear()
    fitnessLocalIdRef.current = null
  }

  decorativeIdsRef.current = decorativeIds

  // Whether a settled attachment still lacks the description the instance
  // requires. Still uploading or failed items are skipped (the tile says so;
  // "add a description" would be misleading until there is a stored media to
  // describe), and so is media already on the status being edited: a legacy
  // item posted without a description must not block a typo fix.
  const isUndescribed = (
    item: PostBoxAttachment,
    decorative: Record<string, true>
  ) =>
    !item.file &&
    !item.isLoading &&
    !originalMediaIdsRef.current.has(item.id) &&
    !(item.name ?? '').trim() &&
    !decorative[item.id]

  // The submit gate. Unlike the tile prompt below (render state), this runs
  // after the uploads have settled: an upload still in flight when Post was
  // clicked has no description yet but may well need one.
  const hasMissingDescriptionAfterUploads = async (
    attachments: PostBoxAttachment[]
  ) => {
    await ensureGallerySettings()
    if (gallerySettingsRef.current?.allowEmptyDescription !== false) {
      return false
    }
    return attachments.some((item) =>
      isUndescribed(item, decorativeIdsRef.current)
    )
  }

  const descriptionRequired = gallerySettings?.allowEmptyDescription === false
  // Post waits for the settings so the description requirement cannot be
  // skipped by posting before they arrive; a failed load fails open.
  // Media already on the status being edited is not re-validated: a legacy
  // item posted without a description must not block a typo fix.
  const hasUndescribedAttachment = postExtension.attachments.some((item) =>
    isUndescribed(item, decorativeIds)
  )
  const settingsLoading =
    hasUndescribedAttachment && !gallerySettings && !settingsFailed
  const missingDescription = descriptionRequired && hasUndescribedAttachment

  // The key and the attempt are written to the draft before the POST. If that
  // write fails the post is NOT sent: a lost response plus a lost key would
  // send the same post again under a new key after a reload.
  const checkpointAttempt = async () => {
    const key = submitIdempotencyRef.current
    if (!key) return true
    if (await composerDraft.recordAttempt(key)) return true
    const conflicted = composerDraft.isConflicted()
    setSubmitError({
      title: "Couldn't send.",
      message: conflicted
        ? DRAFT_CONFLICT_SEND_NOTICE
        : DRAFT_NOT_SAVED_SEND_NOTICE,
      retryable: !conflicted
    })
    setIsPosting(false)
    setAllowPost(true)
    return false
  }

  const onPost = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    if (!allowPost) return
    if (missingDescription || settingsLoading) return
    if (
      !draftLocked &&
      !isWithinLengthLimit(textRef.current, maxStatusCharacters)
    )
      return
    if (submitInFlightRef.current) return
    submitInFlightRef.current = true
    const generation = draftGenerationRef.current
    const retryingLockedDraft = draftLocked

    setAllowPost(false)
    setIsPosting(true)
    setWarningMsg(null)
    setSubmitError(null)
    const message = text
    const contentWarning = postExtension.contentWarningVisible
      ? postExtension.contentWarning
      : ''
    let createAttempt: PostBoxAttachment[] = []
    let createFitnessFileId: string | undefined
    try {
      if (postExtension.poll.showing && postExtension.fitnessFile) {
        setWarningMsg(
          'You cannot create a poll while a fitness file is attached.'
        )
        setIsPosting(false)
        setAllowPost(true)
        return
      }

      if (postExtension.poll.showing) {
        const poll = postExtension.poll
        const choices = poll.choices.map((item) => item.text)
        const pollFingerprint = JSON.stringify({
          type: 'poll',
          message,
          contentWarning,
          choices,
          durationInSeconds: poll.durationInSeconds,
          pollType: poll.pollType,
          replyStatusId: replyStatus?.id ?? null,
          visibility: postExtension.visibility
        })
        if (submitIdempotencyRef.current?.fingerprint !== pollFingerprint) {
          submitIdempotencyRef.current = {
            fingerprint: pollFingerprint,
            key: generatePublicId()
          }
        }
        if (!(await checkpointAttempt())) return
        await createPoll({
          message,
          contentWarning,
          choices,
          durationInSeconds: poll.durationInSeconds,
          pollType: poll.pollType,
          replyStatus,
          visibility: postExtension.visibility,
          idempotencyKey: submitIdempotencyRef.current.key
        })

        submitIdempotencyRef.current = null
        setLockedMessage(null)
        void composerDraft.release()
        // Re-targeted mid-send: the composer now holds the new target's draft.
        if (generation === draftGenerationRef.current) {
          dispatch(resetExtension())
          resetMediaState()
          // Clear the draft like the note branch does. Leaving the question
          // text behind re-arms the (now poll-less) composer, so a second click
          // posts it again as a plain note.
          setText('')
          textRef.current = ''
        }
        setIsPosting(false)
        return
      }

      if (editStatus) {
        const attachments = await uploadMediaAttachments()
        if (await hasMissingDescriptionAfterUploads(attachments)) {
          setIsPosting(false)
          setAllowPost(true)
          return
        }
        const baselineText = getEditableStatusText(editStatus)
        const baselineContentWarning = editStatus.summary ?? ''
        const currentContentWarning = postExtension.contentWarningVisible
          ? postExtension.contentWarning
          : ''
        const attachmentsChanged = !areAttachmentIdsEqualInOrder(
          attachments,
          getEditableStatusAttachments(editStatus)
        )
        const updateMessage = message !== baselineText ? message : undefined
        const updateContentWarning =
          currentContentWarning !== baselineContentWarning
            ? currentContentWarning
            : undefined
        const updateAttachments = attachmentsChanged ? attachments : undefined
        const updateMediaAttributes = getChangedAttachmentDescriptions(
          attachments,
          getEditableStatusAttachments(editStatus)
        )

        if (
          updateMessage === undefined &&
          updateContentWarning === undefined &&
          updateAttachments === undefined &&
          updateMediaAttributes.length === 0
        ) {
          setIsPosting(false)
          return
        }

        const updateResponse = await updateNote({
          statusId: editStatus.id,
          message: updateMessage,
          contentWarning: updateContentWarning,
          attachments: updateAttachments,
          mediaAttributes:
            updateMediaAttributes.length > 0 ? updateMediaAttributes : undefined
        })
        const responseStatus = updateResponse.status
        const responseCreatedAt = getTimestamp(
          responseStatus.createdAt,
          editStatus.createdAt
        )
        const responseUpdatedAt = getTimestamp(
          responseStatus.updatedAt,
          Date.now()
        )
        const responseStatusId = responseStatus.id || editStatus.id
        markAttachmentsPosted(attachments)
        onPostUpdated({
          ...editStatus,
          id: responseStatusId,
          text: responseStatus.text ?? message,
          summary: updateResponse.spoilerText.trim() || null,
          attachments: getStatusAttachmentsFromUpdateResponse({
            actorId: editStatus.actorId,
            existingAttachments: editStatus.attachments,
            mediaAttachments: updateResponse.mediaAttachments,
            uploadedAttachments: attachments,
            statusId: responseStatusId,
            updatedAt: responseUpdatedAt
          }),
          createdAt: responseCreatedAt,
          updatedAt: responseUpdatedAt
        })
        dispatch(resetExtension())
        resetMediaState()

        setText('')
        setIsPosting(false)
        return
      }

      let fitnessFileId: string | undefined
      if (postExtension.fitnessFile) {
        if (postExtension.fitnessFile.uploadedId) {
          fitnessFileId = postExtension.fitnessFile.uploadedId
        } else {
          dispatch(setFitnessFileUploading(true))
          try {
            const uploadedFitnessFile = await uploadFitnessFile(
              postExtension.fitnessFile.file
            )
            fitnessFileId = uploadedFitnessFile.id
            dispatch(setFitnessFileUploaded(uploadedFitnessFile.id))
            // The draft reads the ref, which only follows a render.
            if (postExtensionRef.current.fitnessFile) {
              postExtensionRef.current = {
                ...postExtensionRef.current,
                fitnessFile: {
                  ...postExtensionRef.current.fitnessFile,
                  uploadedId: uploadedFitnessFile.id
                }
              }
            }
          } catch (error) {
            dispatch(setFitnessFileUploading(false))
            // Re-targeted meanwhile: the failure belongs to the draft left
            // behind (offered in the note if it was not kept), not this one.
            if (generation !== draftGenerationRef.current) {
              void composerDraft.leftBehind()
              setIsPosting(false)
              return
            }
            const errorMessage =
              error instanceof Error && error.message
                ? error.message
                : `Fail to upload ${postExtension.fitnessFile.file.name}`
            setWarningMsg(errorMessage)
            setIsPosting(false)
            setAllowPost(true)
            return
          }
        }
      }

      const attachments = await uploadMediaAttachments()
      // Re-targeted while uploading: the draft stays in Drafts as the composer
      // left it, and nothing is sent or written to the new target's composer.
      // If it could not be kept, the not-saved note offers its text; with no
      // drafts at all, the send goes ahead.
      if (
        generation !== draftGenerationRef.current &&
        (await composerDraft.leftBehind()) !== 'none'
      ) {
        setIsPosting(false)
        return
      }
      if (await hasMissingDescriptionAfterUploads(attachments)) {
        setIsPosting(false)
        setAllowPost(true)
        return
      }

      createAttempt = attachments
      createFitnessFileId = fitnessFileId
      const noteFingerprint = JSON.stringify({
        type: 'note',
        message,
        contentWarning,
        replyStatusId: replyStatus?.id ?? null,
        quotedStatusId: quotedStatus?.id ?? null,
        attachmentIds: attachments.map((attachment) => attachment.id),
        fitnessFileId: fitnessFileId ?? null,
        visibility: postExtension.visibility,
        quoteApprovalPolicy: postExtension.quoteApprovalPolicy
      })
      if (submitIdempotencyRef.current?.fingerprint !== noteFingerprint) {
        submitIdempotencyRef.current = {
          fingerprint: noteFingerprint,
          key: generatePublicId()
        }
      }

      if (!(await checkpointAttempt())) return
      const response = await createNote({
        message,
        contentWarning,
        replyStatus,
        quotedStatus,
        attachments,
        fitnessFileId,
        visibility: postExtension.visibility,
        quoteApprovalPolicy: postExtension.quoteApprovalPolicy,
        idempotencyKey: submitIdempotencyRef.current.key
      })

      submitIdempotencyRef.current = null
      setLockedMessage(null)
      const { status, attachments: storedAttachments } = response
      markAttachmentsPosted(attachments)
      // The posted status owns the media now: drop the draft and its bytes only.
      void composerDraft.release()
      onPostCreated(status, storedAttachments)
      // Re-targeted mid-send: the composer now holds the new target's draft.
      if (generation === draftGenerationRef.current) {
        dispatch(resetExtension())
        resetMediaState()
        // resetExtension() drops the policy back to the default 'public';
        // re-apply the actor's configured default so it stays sticky.
        dispatch(setQuoteApprovalPolicy(defaultQuotePolicyRef.current))
        setText('')
      }
      setIsPosting(false)
    } catch (error) {
      setIsPosting(false)
      setAllowPost(true)
      reportRequestFailure(error)
      const fallbackMessage = editStatus
        ? 'Fail to update the post'
        : 'Fail to create a post'
      // The server keeps the post (and the media it uses) only on create.
      const keptByServer = !editStatus && isPostKeptByServer(error)
      if (keptByServer) {
        markAttachmentsPosted(createAttempt)
        if (createFitnessFileId) {
          keptFitnessFileIdsRef.current.add(createFitnessFileId)
        }
      }
      const { action, message: failureMessage } = classifyFailedPost(error, {
        retryingLocked: retryingLockedDraft,
        fallbackMessage,
        wayOut: 'discard the draft',
        kept: keptByServer
      })
      if (generation === draftGenerationRef.current) {
        if (action === 'lock') {
          setLockedMessage(failureMessage)
          // Persist the key and the lock: a reopened draft must retry under the
          // same key, or it duplicates the post the server kept.
          void composerDraft.recordLock(
            failureMessage,
            submitIdempotencyRef.current
          )
        } else {
          if (action === 'unlock') {
            // Nothing is kept under this key any more: let the draft be edited
            // again under a new key instead of stranding it.
            setLockedMessage(null)
            submitIdempotencyRef.current = null
            void composerDraft.recordLock(null, null)
          }
          // A lock shows only its own status line. A stale failure belongs to
          // a previous draft: say nothing on this one.
          setSubmitError({
            title: editStatus ? "Couldn't update." : "Couldn't send.",
            message: failureMessage,
            retryable: true
          })
        }
      } else {
        // Re-targeted mid-send: the draft left behind takes the lock (a reopen
        // must retry under the same key), or the note offers its text if it
        // was not kept; this composer says nothing.
        void composerDraft.leftBehind()
        if (action !== 'none') {
          void composerDraft.recordSentLock(
            action === 'lock' ? failureMessage : null
          )
        }
      }
    } finally {
      submitInFlightRef.current = false
    }
  }

  // The way out of a locked draft: clear it and its key. Its media and
  // fitness file belong to the kept post (marked kept when the server kept
  // it), so they are only dropped from the composer, never deleted.
  const onDiscardLockedDraft = () => {
    if (submitInFlightRef.current) return
    // Before the composer clears: the draft's media is the kept post's, so
    // this deletes only the local record.
    void composerDraft.discard()
    draftGenerationRef.current += 1
    submitIdempotencyRef.current = null
    setLockedMessage(null)
    setWarningMsg(null)
    setSubmitError(null)
    setText('')
    textRef.current = ''
    postExtensionRef.current = createDefaultState()
    dispatch(resetExtension())
    resetMediaState()
    dispatch(setQuoteApprovalPolicy(defaultQuotePolicyRef.current))
    setAllowPost(false)
  }

  // Closing a reply or quote: text worth keeping stays in Drafts (and says
  // so); a locked or empty draft is dropped.
  const settleDraftOnClose = () => {
    if (editStatus) return
    if (!draftLocked && getDraftContent() !== null) void composerDraft.keep()
    else void composerDraft.discard()
  }

  const onCloseReply = () => {
    // A submit in flight owns the draft: closing now would lose its result.
    if (submitInFlightRef.current) return
    settleDraftOnClose()
    onDiscardReply()
    setText('')
  }

  const onCloseQuote = () => {
    if (submitInFlightRef.current) return
    settleDraftOnClose()
    onDiscardQuote?.()
  }

  const onRemoveAttachment = (attachmentId: string) => {
    // Removing deletes the uploaded media, which the in-flight post is using.
    if (isPosting || submitInFlightRef.current) return
    // Read the ref, not the render closure (an upload may have replaced the
    // list since), and resolve the target by id, not by position.
    const attachment = findAttachment(attachmentId)
    if (!attachment) return
    revokeAttachmentUrls(attachment)
    discardUploadedMedia([attachment])
    setUploadError(attachment.id, null)
    const prune = <T,>(record: Record<string, T>) => {
      const { [attachment.id]: _removed, ...rest } = record
      return rest
    }
    setFileNames(prune)
    setDetailsById(prune)
    setDecorativeIds(prune)
    setDetailsPending(prune)
    fetchedDetailsRef.current.delete(attachment.id)
    const nextAttachments = postExtensionRef.current.attachments.filter(
      (item) => item.id !== attachment.id
    )
    const nextExtension = {
      ...postExtensionRef.current,
      attachments: nextAttachments
    }
    postExtensionRef.current = nextExtension
    dispatch(setAttachments(nextAttachments))
    if (editStatus) {
      setAllowPost(isEditSubmittable(textRef.current, nextExtension))
      return
    }
    setAllowPost(
      hasNewPostContent(textRef.current, nextExtension, maxStatusCharacters)
    )
  }

  const onRemoveFitnessFile = useCallback(async () => {
    const fitnessFile = postExtensionRef.current.fitnessFile
    if (!fitnessFile) {
      return true
    }

    const clearFitnessFile = () => {
      dispatch(removeFitnessFile())
      const nextExtension = {
        ...postExtensionRef.current,
        fitnessFile: undefined
      }
      postExtensionRef.current = nextExtension
      setAllowPost(
        hasNewPostContent(textRef.current, nextExtension, maxStatusCharacters)
      )
    }

    const uploadedId = fitnessFile.uploadedId
    if (
      !uploadedId ||
      keptFitnessFileIdsRef.current.has(uploadedId) ||
      composerDraft.deferServerDelete(uploadedId, () =>
        deleteUnpostedFitnessFile(uploadedId)
      )
    ) {
      clearFitnessFile()
      return true
    }

    const inFlight = fitnessCleanupInFlightRef.current
    if (inFlight?.uploadedId === uploadedId) {
      return inFlight.promise
    }

    const cleanupPromise = (async () => {
      try {
        setWarningMsg(null)
        // False: a post uses it (another tab sent this draft), so it stays.
        await deleteUnpostedFitnessFile(uploadedId)
        clearFitnessFile()
        return true
      } catch (error) {
        const errorMessage =
          error instanceof Error && error.message
            ? error.message
            : 'Failed to delete uploaded fitness file'
        setWarningMsg(errorMessage)
        return false
      } finally {
        if (fitnessCleanupInFlightRef.current?.uploadedId === uploadedId) {
          fitnessCleanupInFlightRef.current = null
        }
      }
    })()

    fitnessCleanupInFlightRef.current = {
      uploadedId,
      promise: cleanupPromise
    }

    return cleanupPromise
  }, [maxStatusCharacters])

  const onQuickPost = async (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.metaKey || event.ctrlKey)) return
    if (event.code !== 'Enter') return
    if (!allowPost) return
    if (!formRef.current) return
    await onPost()
  }

  const fitnessFileInputRef = useRef<FitnessFileInputHandle>(null)

  const onTextChange = (value: string) => {
    setText(value)
    textRef.current = value
    if (editStatus) {
      setAllowPost(isEditSubmittable(value))
      return
    }
    setAllowPost(
      hasNewPostContent(value, postExtensionRef.current, maxStatusCharacters)
    )
  }

  const onContentWarningChange = (value: string) => {
    dispatch(setContentWarning(value))
    if (!editStatus) return

    const nextExtension = {
      ...postExtensionRef.current,
      contentWarning: value,
      contentWarningVisible:
        postExtensionRef.current.contentWarningVisible || value.length > 0
    }
    postExtensionRef.current = nextExtension
    setAllowPost(isEditSubmittable(textRef.current, nextExtension))
  }

  const onFitnessFileSelected = (file: File) => {
    setWarningMsg(null)
    discardUploadedMedia(postExtensionRef.current.attachments)
    resetMediaState()
    postExtensionRef.current.attachments.forEach((attachment) => {
      if (attachment.url.startsWith('blob:')) {
        URL.revokeObjectURL(attachment.url)
      }
      if (attachment.posterUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(attachment.posterUrl)
      }
    })
    dispatch(setAttachments([]))
    postExtensionRef.current = {
      ...postExtensionRef.current,
      attachments: []
    }
    const nextExtension = {
      ...postExtensionRef.current,
      fitnessFile: { file, uploading: false }
    }
    postExtensionRef.current = nextExtension
    dispatch(setFitnessFile(file))
    if (!editStatus) {
      fitnessLocalIdRef.current = generatePublicId()
      composerDraft.attachBlob(fitnessLocalIdRef.current, file)
    }
    setAllowPost(
      hasNewPostContent(textRef.current, nextExtension, maxStatusCharacters)
    )
  }

  const onTogglePoll = () => {
    // The poll replaces any attached media (the reducer drops it and revokes
    // the previews), so delete what was already uploaded for it instead of
    // orphaning it on the server.
    if (!submitInFlightRef.current) {
      discardUploadedMedia(postExtensionRef.current.attachments)
      resetMediaState()
    }
    dispatch(setPollVisibility(!postExtension.poll.showing))
  }

  const onToggleContentWarning = () => {
    const nextVisible = !postExtension.contentWarningVisible
    dispatch(setContentWarningVisibility(nextVisible))
    if (!editStatus) return

    const nextExtension = {
      ...postExtensionRef.current,
      contentWarningVisible: nextVisible
    }
    postExtensionRef.current = nextExtension
    setAllowPost(isEditSubmittable(textRef.current, nextExtension))
  }

  /**
   * Handle default message in Postbox
   *
   * - If there is no reply, always return empty string
   * - If there is reply, but the reply is current actor, don't append current
   *   actor handle name.
   * - If there is reply, return reply status actor handle name with domain,
   *   followed by the other mention handles carried on the reply's tags
   *   (excluding the current actor).
   *
   * @param profile current actor profile
   * @param replyStatus status that user want to reply to
   * @returns default message that user will use to send out the status with start and end selection
   */
  const getDefaultMessage = (
    profile: ActorProfile,
    replyStatus?: StatusNote
  ): [string, number, number] | null => {
    if (!replyStatus) return null
    if (replyStatus.actorId === profile.id) return null

    const message = replyStatus.actor
      ? `${getMention(replyStatus.actor, true)} `
      : `${getMentionFromActorID(replyStatus.actorId, true)} `
    const others = replyStatus.tags
      .filter((item) => item.type === 'mention')
      .filter((item) => item.name !== getMention(profile, true))
      .map((item) => {
        if (item.name.slice(1).includes('@')) return item.name
        try {
          const url = new URL(item.value)
          return `${item.name}@${url.host}`
        } catch {
          return item.name
        }
      })
      .join(' ')

    if (others.length > 0) {
      return [
        `${message} ${others} `,
        message.length + 1,
        message.length + others.length + 1
      ]
    }

    return [message, message.length, message.length]
  }

  useEffect(() => {
    if (!replyStatus) return
    if (!postExtension.fitnessFile) return
    void onRemoveFitnessFile()
  }, [replyStatus, postExtension.fitnessFile, onRemoveFitnessFile])

  // Puts a reopened draft back in the composer. The draft's own revision, key
  // and lock are already in the hook; this restores what the author sees.
  // Attachments the server already has are used as they are (never uploaded
  // again, so the submit fingerprint and its key stay the same); the ones that
  // never finished uploading are rebuilt from the kept bytes and uploaded.
  const seedFromDraft = (seed: DraftRecord) => {
    const apply = (files: Awaited<ReturnType<typeof loadDraftFiles>>) => {
      const pending: PostBoxAttachment[] = []
      const attachments: PostBoxAttachment[] = []
      const names: Record<string, string> = {}
      const decorative: Record<string, true> = {}
      const keys: Record<string, string> = {}
      for (const item of seed.attachments) {
        const restored = fromDraftAttachment(item, files)
        // The bytes are gone and the server never had it: nothing to restore.
        if (!restored) continue
        if (item.mediaId) {
          attachments.push(restored)
          names[item.mediaId] = item.fileName
          keys[item.mediaId] = item.localId
          localIdByIdRef.current.set(item.mediaId, item.localId)
          if (item.decorative) decorative[item.mediaId] = true
          // A locked draft's media belongs to the post the server kept.
          if (!item.owned) postedMediaIdsRef.current.add(item.mediaId)
          continue
        }
        const attachment: PostBoxAttachment = { ...restored, isLoading: true }
        attachments.push(attachment)
        pending.push(attachment)
      }

      let fitnessFile:
        { file: File; uploading: boolean; uploadedId?: string } | undefined
      const savedFitness = seed.fitnessFile
      if (savedFitness) {
        const stored = files.get(savedFitness.localId)
        if (stored || savedFitness.fitnessFileId) {
          fitnessFile = {
            file:
              stored?.file ??
              new File([], savedFitness.fileName, {
                type: savedFitness.mimeType
              }),
            uploading: false,
            uploadedId: savedFitness.fitnessFileId
          }
          fitnessLocalIdRef.current = savedFitness.localId
          // The file may be in use by a post the server kept or may have kept.
          if (
            savedFitness.fitnessFileId &&
            (!savedFitness.owned || seed.attemptedAt)
          ) {
            keptFitnessFileIdsRef.current.add(savedFitness.fitnessFileId)
          }
        }
      }

      const nextExtension = {
        ...createDefaultState(),
        attachments,
        contentWarning: seed.contentWarning,
        contentWarningVisible: seed.contentWarningVisible,
        visibility: seed.visibility,
        quoteApprovalPolicy: seed.quoteApprovalPolicy,
        fitnessFile,
        poll: seed.poll
          ? {
              showing: true,
              choices: createChoices(seed.poll.choices),
              durationInSeconds: seed.poll.durationInSeconds,
              pollType: seed.poll.pollType
            }
          : createDefaultState().poll
      }
      postExtensionRef.current = nextExtension
      dispatch(loadExtension(nextExtension))
      setFileNames(names)
      setDecorativeIds(decorative)
      decorativeIdsRef.current = decorative
      setClientKeys(keys)
      textRef.current = seed.text
      setText(seed.text)
      submitIdempotencyRef.current = seed.submit ?? null
      setLockedMessage(seed.lockedMessage ?? null)
      setDraftSeedVersion((version) => version + 1)
      pending.forEach((attachment) => startUpload(attachment))
      attachments
        .filter((attachment) => !attachment.file)
        .forEach((attachment) => void loadDetails(attachment.id))
    }

    const needsBytes =
      seed.attachments.some((item) => !item.mediaId) || seed.fitnessFile
    if (!needsBytes) {
      apply(new Map())
      return
    }
    draftSeedingRef.current = true
    void loadDraftFiles(seed).then((files) => {
      draftSeedingRef.current = false
      if (isMountedRef.current) apply(files)
    })
  }

  useEffect(() => {
    // A composer opened from a draft is that draft's composer: it is never
    // re-targeted, and React StrictMode's second run must not reset it.
    if (draft && draftSeededRef.current) return
    // The photos a "Post" action in Gallery handed over. They seed the first
    // time through. React StrictMode re-runs effects in development before the
    // seeded photos have been drawn, and the profile can change identity
    // later: while those photos are still the whole draft, seed them again
    // rather than lose them.
    const keptIds = keptMediaIdsRef.current
    const currentAttachments = postExtensionRef.current.attachments
    const seedStillWhole = seededMediaShownRef.current
      ? keptIds.size > 0 &&
        currentAttachments.length === keptIds.size &&
        currentAttachments.every((attachment) => keptIds.has(attachment.id))
      : currentAttachments.length === 0
    const seedAttachments = !initialMediaTakenRef.current
      ? (initialMedia ?? []).slice(0, maxMediaAttachments)
      : seedStillWhole
        ? seededMediaRef.current
        : []

    // The composer is being re-targeted: media uploaded for the previous draft
    // and never posted is abandoned (unless a submit is still using it).
    // A saved draft keeps its media and is left behind as it is.
    // The first run for a reopened draft has nothing to leave behind: the draft
    // is this composer's own.
    const reopening = Boolean(draft) && !draftSeededRef.current
    const draftOwnsMedia = !reopening && composerDraft.hasDraft()
    // A send in flight keeps its own draft: the new target never writes into it.
    if (draftOwnsMedia || (!reopening && submitInFlightRef.current)) {
      void composerDraft.detach()
    }
    if (!submitInFlightRef.current && !draftOwnsMedia) {
      discardUploadedMedia(postExtensionRef.current.attachments)
    }
    setLockedMessage(null)
    setSubmitError(null)
    draftGenerationRef.current += 1
    if (draft && !editStatus) {
      draftSeededRef.current = true
      originalMediaIdsRef.current = new Set()
      initialMediaTakenRef.current = true
      if (quotedStatus) {
        setTimeout(() => postBoxRef.current?.focus(), 0)
      }
      seedFromDraft(draft)
      return
    }
    if (editStatus) {
      const editText = getEditableStatusText(editStatus)
      const attachments = getEditableStatusAttachments(editStatus)
      originalMediaIdsRef.current = new Set(
        attachments.map((attachment) => attachment.id)
      )
      const nextExtension = {
        ...createDefaultState(),
        attachments,
        contentWarning: editStatus.summary ?? '',
        contentWarningVisible: Boolean(editStatus.summary)
      }
      postExtensionRef.current = nextExtension
      resetMediaState()
      textRef.current = editText
      setText(editText)
      dispatch(setAttachments(attachments))
      dispatch(setContentWarning(editStatus.summary ?? ''))
      dispatch(setContentWarningVisibility(Boolean(editStatus.summary)))
      setAllowPost(false)
      return
    } else {
      originalMediaIdsRef.current = new Set()
      setText('')
      textRef.current = ''
      postExtensionRef.current = createDefaultState()
      dispatch(resetExtension())
      resetMediaState()
      setAllowPost(false)
    }

    const seeded = !replyStatus && !quotedStatus ? seedAttachments : []
    initialMediaTakenRef.current = true
    seededMediaRef.current = seeded
    if (seeded.length === 0) seededMediaShownRef.current = false
    keptMediaIdsRef.current = new Set(seeded.map((attachment) => attachment.id))
    if (seeded.length > 0) {
      postExtensionRef.current = {
        ...postExtensionRef.current,
        attachments: seeded
      }
      dispatch(setAttachments(seeded))
      setAllowPost(true)
      seeded.forEach((attachment) => void loadDetails(attachment.id))
    }

    if (!replyStatus) {
      // Reset visibility to default when not replying
      dispatch(setVisibility('public'))
    } else {
      // Initialize visibility from reply status to inherit parent visibility
      const replyVisibility = getVisibility(replyStatus.to, replyStatus.cc)
      dispatch(setVisibility(replyVisibility))
    }

    const defaultReplyMessage =
      replyStatus && replyStatus.type === StatusType.enum.Note
        ? getDefaultMessage(profile, replyStatus)
        : null

    initialTextRef.current = defaultReplyMessage?.[0] ?? ''
    if (defaultReplyMessage) {
      const [replyText, replyStart, replyEnd] = defaultReplyMessage
      setText(replyText)
      textRef.current = replyText
      setAllowPost(
        hasNewPostContent(
          replyText,
          postExtensionRef.current,
          maxStatusCharacters
        )
      )

      setTimeout(() => {
        if (postBoxRef.current) {
          postBoxRef.current.selectionStart = replyStart
          postBoxRef.current.selectionEnd = replyEnd
          postBoxRef.current.focus()
        }
      }, 0)
      return
    }

    if (quotedStatus) {
      setTimeout(() => {
        if (postBoxRef.current) {
          postBoxRef.current.focus()
        }
      }, 0)
    }
  }, [profile, replyStatus, editStatus, quotedStatus])

  const detailsDialogItems: MediaDetailsDialogItem[] = postExtension.attachments
    // Items still reading their details have nothing to edit yet.
    .filter((item) => !item.file && !item.isLoading && !detailsPending[item.id])
    .map((item) => ({
      id: item.id,
      mediaType: item.mediaType,
      url: item.url,
      posterUrl: item.posterUrl,
      width: item.width,
      height: item.height,
      description: item.name ?? '',
      decorative: Boolean(decorativeIds[item.id]),
      details: detailsById[item.id] ?? null
    }))

  const form = (
    <>
      <form ref={formRef} onSubmit={onPost} onInput={composerDraft.schedule}>
        <div className="flex items-start gap-3 mb-3">
          <Avatar className="size-12">
            <AvatarImage
              src={profile.iconUrl}
              alt={profile.name ?? profile.username}
            />
            <AvatarFallback>
              {(profile.name ?? profile.username).charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0 space-y-3">
            <ReplyPreview
              host={host}
              status={replyStatus}
              onClose={onCloseReply}
              disabled={draftLocked || isPosting}
            />
            <QuotedPreview
              host={host}
              status={quotedStatus}
              onClose={onCloseQuote}
              disabled={draftLocked || isPosting}
            />
            {postExtension.contentWarningVisible ? (
              <input
                type="text"
                className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                aria-label="Content warning"
                name="contentWarning"
                placeholder="Write your warning here"
                value={postExtension.contentWarning}
                readOnly={draftLocked}
                onChange={(event) => onContentWarningChange(event.target.value)}
              />
            ) : null}

            <textarea
              ref={postBoxRef}
              className="flex min-h-[72px] max-h-[min(320px,40dvh)] w-full resize-none bg-transparent text-base leading-relaxed placeholder:text-muted-foreground focus-visible:outline-none field-sizing-content overflow-y-auto md:text-sm"
              rows={2}
              onKeyDown={onQuickPost}
              onChange={(e) => onTextChange(e.target.value)}
              name="message"
              placeholder="What is on your mind?"
              value={text}
              readOnly={draftLocked}
            />

            {composerDraft.saveState !== 'idle' ||
            (showDraftsLink && (drafts?.count ?? 0) > 0) ? (
              <div className="flex items-center justify-between gap-3">
                <DraftSaveStatus
                  saveState={composerDraft.saveState}
                  text={text}
                />
                {showDraftsLink ? (
                  <div className="ml-auto">
                    <DraftsLink excludeId={composerDraft.draftId} />
                  </div>
                ) : null}
              </div>
            ) : null}

            {showPreview ? (
              <div className="rounded-lg border bg-background p-3">
                <div className="mb-2 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  <Eye className="size-3" /> Preview
                </div>
                {postExtension.contentWarningVisible &&
                postExtension.contentWarning ? (
                  <ContentWarning
                    summary={postExtension.contentWarning}
                    tags={buildSyntheticEmojiTags([
                      text,
                      postExtension.contentWarning
                    ])}
                    defaultOpen
                  >
                    <div className="markdown-content max-w-none text-sm">
                      {cleanClassName(
                        processStatusTextContent(
                          host,
                          text,
                          buildSyntheticEmojiTags([
                            text,
                            postExtension.contentWarning
                          ]),
                          true
                        )
                      )}
                    </div>
                  </ContentWarning>
                ) : text ? (
                  <div className="markdown-content max-w-none text-sm">
                    {cleanClassName(
                      processStatusTextContent(
                        host,
                        text,
                        buildSyntheticEmojiTags(text),
                        true
                      )
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Nothing to preview
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </div>

        <PollChoices
          show={postExtension.poll.showing}
          choices={postExtension.poll.choices}
          durationInSeconds={postExtension.poll.durationInSeconds}
          pollType={postExtension.poll.pollType}
          disabled={draftLocked}
          onAddChoice={() => dispatch(addPollChoice(maxPollOptions))}
          onRemoveChoice={(index) => dispatch(removePollChoice(index))}
          onChooseDuration={(durationInSeconds: Duration) =>
            dispatch(setPollDurationInSeconds(durationInSeconds))
          }
          onPollTypeChange={(pollType) => dispatch(setPollType(pollType))}
          onRemove={() => dispatch(setPollVisibility(false))}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
          <div className="flex min-w-0 items-center gap-1">
            <UploadMediaButton
              isMediaUploadEnabled={isMediaUploadEnabled}
              attachments={postExtension.attachments}
              fileNames={fileNames}
              disabled={isPosting || draftLocked}
              onAddAttachment={(attachment) => {
                // A picker batch that resolves after submit began must not
                // change what is being posted: the submit already captured
                // the attachments, and a late one would upload for nothing.
                if (submitInFlightRef.current || draftLockedRef.current) {
                  if (attachment.url.startsWith('blob:')) {
                    URL.revokeObjectURL(attachment.url)
                  }
                  if (attachment.posterUrl?.startsWith('blob:')) {
                    URL.revokeObjectURL(attachment.posterUrl)
                  }
                  return
                }
                // Bounds postExtensionRef, not postExtension: this callback
                // writes the ref synchronously below, before dispatch, so
                // the reducer's own addAttachment cap (which guards only the
                // committed postExtension) never sees a ref that already
                // raced ahead of it. Two overlapping picker batches can each
                // read a stale, still-below-cap availableSlots before either
                // resolves, so this check is not redundant with the
                // picker's availableSlots gate or the reducer's cap — do not
                // delete it as a "already checked twice" simplification.
                if (
                  postExtensionRef.current.attachments.length >=
                  maxMediaAttachments
                ) {
                  if (attachment.url.startsWith('blob:')) {
                    URL.revokeObjectURL(attachment.url)
                  }
                  if (attachment.posterUrl?.startsWith('blob:')) {
                    URL.revokeObjectURL(attachment.posterUrl)
                  }
                  return
                }
                // Pending from the start: the upload begins right below.
                const pendingAttachment = attachment.file
                  ? { ...attachment, isLoading: true }
                  : attachment
                const nextExtension = {
                  ...postExtensionRef.current,
                  attachments: [
                    ...postExtensionRef.current.attachments,
                    pendingAttachment
                  ],
                  fitnessFile: undefined,
                  poll: {
                    ...createDefaultState().poll
                  }
                }
                postExtensionRef.current = nextExtension
                dispatch(addAttachment(pendingAttachment, maxMediaAttachments))
                startUpload(pendingAttachment)
                if (!editStatus && attachment.file) {
                  composerDraft.attachBlob(
                    pendingAttachment.id,
                    attachment.file,
                    attachment.posterFile
                  )
                }
                if (editStatus) {
                  setAllowPost(
                    isEditSubmittable(textRef.current, nextExtension)
                  )
                  return
                }
                setAllowPost(
                  hasNewPostContent(
                    textRef.current,
                    nextExtension,
                    maxStatusCharacters
                  )
                )
              }}
              onDuplicateError={() =>
                setWarningMsg('Some files are already selected')
              }
              onFilesRejected={(message) => setWarningMsg(message)}
              onUploadStart={() => setWarningMsg(null)}
              onBeforeAddAttachments={onRemoveFitnessFile}
            />
            <EmojiPickerButton
              customEmojis={customEmojis}
              onSelect={insertAtCaret}
              disabled={isPosting || draftLocked}
            />
            <PostOptionsMenu
              disabled={isPosting || draftLocked}
              showFitnessFile={!replyStatus && !editStatus}
              onChooseFitnessFile={() => fitnessFileInputRef.current?.open()}
              pollShowing={postExtension.poll.showing}
              quoting={Boolean(quotedStatus)}
              onTogglePoll={onTogglePoll}
              visibility={postExtension.visibility}
              onVisibilityChange={(visibility) =>
                dispatch(setVisibility(visibility))
              }
              quotePolicy={postExtension.quoteApprovalPolicy}
              onQuotePolicyChange={(policy) =>
                dispatch(setQuoteApprovalPolicy(policy))
              }
              contentWarningVisible={postExtension.contentWarningVisible}
              onToggleContentWarning={onToggleContentWarning}
              previewShowing={showPreview}
              onTogglePreview={() => setShowPreview((value) => !value)}
            />
            {!replyStatus && !editStatus ? (
              <FitnessFileInput
                ref={fitnessFileInputRef}
                onFileSelected={onFitnessFileSelected}
                onError={(message) => setWarningMsg(message)}
              />
            ) : null}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span
              className={cn(
                'text-xs tabular-nums',
                !draftLocked && text.length > maxStatusCharacters
                  ? 'text-destructive'
                  : 'text-muted-foreground'
              )}
            >
              {maxStatusCharacters - text.length}
            </span>
            {editStatus ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={onDiscardEdit}
                // Below md only an icon: with the three 40px buttons on the
                // left the toolbar must stay on one line at 320px.
                title="Cancel Edit"
                className="max-md:size-8 max-md:has-[>svg]:px-0 md:has-[>svg]:px-3"
              >
                <X className="size-4 md:hidden" aria-hidden="true" />
                <span className="max-md:sr-only">Cancel Edit</span>
              </Button>
            ) : null}
            <Button
              disabled={
                !allowPost || isPosting || missingDescription || settingsLoading
              }
              type="submit"
              size="sm"
            >
              {editStatus ? 'Update' : isPosting ? 'Posting…' : 'Post'}
            </Button>
          </div>
        </div>
        {warningMsg ? (
          <div role="alert" className="mt-3 text-xs text-destructive-text">
            {warningMsg}
          </div>
        ) : null}
        {lockedMessage ? (
          <div className="mt-3 flex items-center justify-between gap-2">
            <div role="status" className="text-xs text-muted-foreground">
              {lockedMessage} {DRAFT_LOCKED_NOTICE}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0"
              disabled={isPosting}
              onClick={onDiscardLockedDraft}
            >
              Discard draft
            </Button>
          </div>
        ) : null}
        {missingDescription ? (
          <div className="mt-3 text-xs text-destructive-text" role="status">
            Add a description to every item, or mark it decorative
          </div>
        ) : null}
        {!replyStatus && postExtension.fitnessFile ? (
          <div className="mt-3 flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <Activity className="size-4 shrink-0 text-muted-foreground" />
              <span className="shrink-0 text-muted-foreground">Fitness:</span>
              <span className="truncate font-medium">
                {postExtension.fitnessFile.file.name}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatFileSize(postExtension.fitnessFile.file.size)}
              </span>
              {postExtension.fitnessFile.uploading ? (
                <span className="shrink-0 text-xs text-muted-foreground">
                  Uploading…
                </span>
              ) : null}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Remove selected fitness file"
              disabled={draftLocked}
              onClick={() => void onRemoveFitnessFile()}
            >
              <X className="size-4" />
            </Button>
          </div>
        ) : null}
        <ComposerAttachmentTiles
          attachments={postExtension.attachments}
          fileNames={fileNames}
          detailsById={detailsById}
          clientKeys={clientKeys}
          decorativeIds={decorativeIds}
          uploadErrors={uploadErrors}
          detailsPending={detailsPending}
          suggestionsPending={suggestionsPending}
          confidenceThreshold={gallerySettings?.subjectConfidenceThreshold}
          suggestionsEnabled={
            Boolean(gallerySettings?.subjectSuggestionsAvailable) &&
            gallerySettings?.subjectSuggestionMode === 'model'
          }
          disabled={isPosting || draftLocked}
          onOpen={(id) => void openDetails(id)}
          onRemove={onRemoveAttachment}
          onRetry={(id) => {
            const attachment = findAttachment(id)
            if (attachment) startUpload(attachment)
          }}
        />
      </form>
      {activeDetailsId ? (
        <MediaDetailsDialog
          items={detailsDialogItems}
          initialId={activeDetailsId}
          settings={gallerySettings}
          onClose={closeDetails}
          onSaved={onDetailsSaved}
          onMediaEdited={onMediaEdited}
          onDetailsRefreshed={(id, patch, details) =>
            // Merged into the latest details, not replaced by the dialog's
            // copy, so two refreshes that finish out of order both land.
            setDetailsById((current) => ({
              ...current,
              [id]: current[id] ? { ...current[id], ...patch } : details
            }))
          }
          suggestionsPending={suggestionsPending}
          ownerId={profile.id}
        />
      ) : null}
    </>
  )

  return (
    // The home feed below is pulled up 24px on a phone so it meets the card's
    // divider; an Alert in between hands that gap back (padding, because a
    // margin here would collapse into the pull).
    <div className={cn(frameClassName && submitError && 'max-md:pb-6')}>
      {frameClassName ? (
        <section className={frameClassName}>{form}</section>
      ) : (
        form
      )}
      {/* After the card, never inside it. */}
      {submitError ? (
        <Alert
          title={submitError.title}
          onRetry={submitError.retryable ? () => void onPost() : undefined}
          className="mt-3"
        >
          {submitError.message}
          {!editStatus && composerDraft.saveState === 'saved'
            ? `${/[.!?]$/.test(submitError.message.trim()) ? '' : '.'} Your post is saved as a draft.`
            : ''}
        </Alert>
      ) : null}
    </div>
  )
}
