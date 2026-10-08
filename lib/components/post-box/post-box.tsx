import { Activity, AlertTriangle, BarChart3, Eye, X } from 'lucide-react'
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
  deleteAccountMedia,
  deleteFitnessFile,
  getCustomEmojis,
  getDefaultQuotePolicy,
  getGallerySettings,
  getMedia,
  suggestMediaSubjects,
  updateNote,
  uploadAttachment,
  uploadFitnessFile
} from '@/lib/client'
import { useInstanceLimits } from '@/lib/components/instance-limits'
import {
  MediaDetailsDialog,
  MediaDetailsDialogItem,
  MediaDetailsSavedItem
} from '@/lib/components/media-details/media-details-dialog'
import { ContentWarning } from '@/lib/components/posts/content-warning'
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
import { cleanClassName } from '@/lib/utils/text/cleanClassName'
import { getEmojiTags } from '@/lib/utils/text/getEmojiTags'
import { processStatusTextContent } from '@/lib/utils/text/processStatusText'

import {
  ComposerAttachmentTiles,
  getAttachmentLabel
} from './composer-attachment-tiles'
import {
  areAttachmentIdsEqualInOrder,
  getChangedAttachmentDescriptions,
  getEditableStatusAttachments,
  getStatusAttachmentsFromUpdateResponse,
  getTimestamp
} from './composerAttachments'
import {
  isEditSubmittable as checkIsEditSubmittable,
  getEditableStatusText,
  hasNewPostContent,
  isWithinLengthLimit
} from './composerValidation'
import { EmojiPickerButton } from './emoji-picker-button'
import { PollChoices } from './poll-choices'
import { QuotedPreview } from './quoted-preview'
import {
  addAttachment,
  addPollChoice,
  createDefaultState,
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
import { UploadFitnessFileButton } from './upload-fitness-file-button'
import { UploadMediaButton } from './upload-media-button'
import { VisibilitySelector } from './visibility-selector'

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
  onDiscardReply: () => void
  onDiscardQuote?: () => void
  onPostCreated: (status: Status, attachments: Attachment[]) => void
  onPostUpdated: (status: Status) => void
  onDiscardEdit: () => void
}

export const PostBox: FC<Props> = ({
  host,
  profile,
  replyStatus,
  editStatus,
  quotedStatus,
  isMediaUploadEnabled,
  onPostCreated,
  onPostUpdated,
  onDiscardReply,
  onDiscardQuote,
  onDiscardEdit
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
  const postBoxRef = useRef<HTMLTextAreaElement>(null)
  useAutoResizeTextarea(postBoxRef, text)
  const formRef = useRef<HTMLFormElement>(null)
  const textRef = useRef(text)
  const submitInFlightRef = useRef(false)
  // Ids of media that a create/update has already accepted. A parent may
  // unmount the composer from inside `onPostCreated`/`onPostUpdated` (after
  // which `submitInFlightRef` is already false again), so every discard path
  // skips these: media that was posted must never be deleted.
  const postedMediaIdsRef = useRef(new Set<string>())
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
  const isMountedRef = useRef(true)
  // Media details live beside the attachments, keyed by media id, rather than
  // on PostBoxAttachment: that type is what goes to the outbox, and the details
  // (subject, gear, place) are already saved on the media row by the dialog.
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

  useEffect(() => {
    postExtensionRef.current = postExtension
  }, [postExtension])

  useEffect(() => {
    let active = true
    getDefaultQuotePolicy().then((policy) => {
      if (!active) return
      defaultQuotePolicyRef.current = policy
      dispatch(setQuoteApprovalPolicy(policy))
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
    setAllowPost(
      hasNewPostContent(
        textRef.current,
        postExtensionRef.current,
        maxStatusCharacters
      )
    )
    // Deliberately keyed only on the limit and the in-flight flag (plus the
    // edit target, to pick the right predicate): the draft itself is read from
    // refs, and every draft edit already recomputes `allowPost` in its handler.
  }, [maxStatusCharacters, isPosting, editStatus])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      // Uploads happen on attach, so media still in the composer when it goes
      // away was never posted: delete it (unless a submit is using it).
      if (!submitInFlightRef.current) {
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
  // attachments of a status being edited are never deleted.
  function discardUploadedMedia(attachments: PostBoxAttachment[]) {
    attachments.forEach((attachment) => {
      if (attachment.file || attachment.isLoading) return
      if (originalMediaIdsRef.current.has(attachment.id)) return
      if (postedMediaIdsRef.current.has(attachment.id)) return
      deleteAccountMedia({ mediaId: attachment.id }).catch(() => undefined)
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
          deleteAccountMedia({ mediaId: uploaded.id }).catch(() => undefined)
          return
        }
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

  const onPost = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    if (!allowPost) return
    if (missingDescription || settingsLoading) return
    if (!isWithinLengthLimit(textRef.current, maxStatusCharacters)) return
    if (submitInFlightRef.current) return
    submitInFlightRef.current = true

    setAllowPost(false)
    setIsPosting(true)
    setWarningMsg(null)
    const message = text
    const contentWarning = postExtension.contentWarningVisible
      ? postExtension.contentWarning
      : ''
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
        await createPoll({
          message,
          contentWarning,
          choices: poll.choices.map((item) => item.text),
          durationInSeconds: poll.durationInSeconds,
          pollType: poll.pollType,
          replyStatus,
          visibility: postExtension.visibility
        })

        dispatch(resetExtension())
        resetMediaState()
        // Clear the draft like the note branch does. Leaving the question text
        // behind re-arms the (now poll-less) composer, so a second click posts
        // it again as a plain note.
        setText('')
        textRef.current = ''
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
          } catch (error) {
            dispatch(setFitnessFileUploading(false))
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
      if (await hasMissingDescriptionAfterUploads(attachments)) {
        setIsPosting(false)
        setAllowPost(true)
        return
      }

      const response = await createNote({
        message,
        contentWarning,
        replyStatus,
        quotedStatus,
        attachments,
        fitnessFileId,
        visibility: postExtension.visibility,
        quoteApprovalPolicy: postExtension.quoteApprovalPolicy
      })

      const { status, attachments: storedAttachments } = response
      markAttachmentsPosted(attachments)
      onPostCreated(status, storedAttachments)
      dispatch(resetExtension())
      resetMediaState()
      // resetExtension() drops the policy back to the default 'public';
      // re-apply the actor's configured default so it stays sticky.
      dispatch(setQuoteApprovalPolicy(defaultQuotePolicyRef.current))

      setText('')
      setIsPosting(false)
    } catch (error) {
      setIsPosting(false)
      setAllowPost(true)
      const fallbackMessage = editStatus
        ? 'Fail to update the post'
        : 'Fail to create a post'
      alert(
        error instanceof Error && error.message
          ? error.message
          : fallbackMessage
      )
    } finally {
      submitInFlightRef.current = false
    }
  }

  const onCloseReply = () => {
    onDiscardReply()
    setText('')
  }

  const onCloseQuote = () => {
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

    if (!fitnessFile.uploadedId) {
      clearFitnessFile()
      return true
    }

    const inFlight = fitnessCleanupInFlightRef.current
    if (inFlight?.uploadedId === fitnessFile.uploadedId) {
      return inFlight.promise
    }

    const uploadedId = fitnessFile.uploadedId

    const cleanupPromise = (async () => {
      try {
        setWarningMsg(null)
        await deleteFitnessFile(uploadedId)
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

  useEffect(() => {
    // The composer is being re-targeted: media uploaded for the previous draft
    // and never posted is abandoned (unless a submit is still using it).
    if (!submitInFlightRef.current) {
      discardUploadedMedia(postExtensionRef.current.attachments)
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

  return (
    <div>
      <form ref={formRef} onSubmit={onPost}>
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
            />
            <QuotedPreview
              host={host}
              status={quotedStatus}
              onClose={onCloseQuote}
            />
            {postExtension.contentWarningVisible ? (
              <input
                type="text"
                className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                aria-label="Content warning"
                name="contentWarning"
                placeholder="Write your warning here"
                value={postExtension.contentWarning}
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
            />

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
          onAddChoice={() => dispatch(addPollChoice(maxPollOptions))}
          onRemoveChoice={(index) => dispatch(removePollChoice(index))}
          onChooseDuration={(durationInSeconds: Duration) =>
            dispatch(setPollDurationInSeconds(durationInSeconds))
          }
          onPollTypeChange={(pollType) => dispatch(setPollType(pollType))}
          onRemove={() => dispatch(setPollVisibility(false))}
        />
        <div className="mt-3 mb-3 flex flex-wrap items-center gap-y-2 border-t pt-3">
          <div className="flex flex-wrap items-center gap-1">
            <UploadMediaButton
              isMediaUploadEnabled={isMediaUploadEnabled}
              attachments={postExtension.attachments}
              fileNames={fileNames}
              disabled={isPosting}
              onAddAttachment={(attachment) => {
                // A picker batch that resolves after submit began must not
                // change what is being posted: the submit already captured
                // the attachments, and a late one would upload for nothing.
                if (submitInFlightRef.current) {
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
            {!replyStatus && !editStatus ? (
              <UploadFitnessFileButton
                disabled={isPosting}
                onFileSelected={(file) => {
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
                  setAllowPost(
                    hasNewPostContent(
                      textRef.current,
                      nextExtension,
                      maxStatusCharacters
                    )
                  )
                }}
                onError={(message) => setWarningMsg(message)}
              />
            ) : null}
            <EmojiPickerButton
              customEmojis={customEmojis}
              onSelect={insertAtCaret}
              disabled={isPosting}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={
                postExtension.poll.showing ? 'Remove poll' : 'Add poll'
              }
              aria-pressed={postExtension.poll.showing}
              // A quote post cannot carry a poll (they are mutually exclusive,
              // like media); disable the toggle while quoting.
              disabled={isPosting || Boolean(quotedStatus)}
              title={
                quotedStatus
                  ? 'A quote post cannot include a poll'
                  : postExtension.poll.showing
                    ? 'Remove poll'
                    : 'Add poll'
              }
              className={cn(
                postExtension.poll.showing
                  ? 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => {
                // The poll replaces any attached media (the reducer drops it
                // and revokes the previews), so delete what was already
                // uploaded for it instead of orphaning it on the server.
                if (!submitInFlightRef.current) {
                  discardUploadedMedia(postExtensionRef.current.attachments)
                  resetMediaState()
                }
                dispatch(setPollVisibility(!postExtension.poll.showing))
              }}
            >
              <BarChart3 className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={cn(
                postExtension.contentWarningVisible
                  ? 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              aria-label={
                postExtension.contentWarningVisible
                  ? 'Remove content warning'
                  : 'Add content warning'
              }
              aria-pressed={postExtension.contentWarningVisible}
              disabled={isPosting}
              title={
                postExtension.contentWarningVisible
                  ? 'Remove content warning'
                  : 'Add content warning'
              }
              onClick={onToggleContentWarning}
            >
              <AlertTriangle className="size-4" />
            </Button>
            <VisibilitySelector
              visibility={postExtension.visibility}
              onVisibilityChange={(visibility) =>
                dispatch(setVisibility(visibility))
              }
              quotePolicy={postExtension.quoteApprovalPolicy}
              onQuotePolicyChange={(policy) =>
                dispatch(setQuoteApprovalPolicy(policy))
              }
              disabled={isPosting}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={cn(
                'text-muted-foreground hover:text-foreground',
                showPreview && 'bg-primary/10 text-primary'
              )}
              aria-label="Toggle preview"
              aria-pressed={showPreview}
              title="Toggle preview"
              onClick={() => setShowPreview((value) => !value)}
            >
              <Eye className="size-4" />
            </Button>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span
              className={cn(
                'text-xs tabular-nums',
                text.length > maxStatusCharacters
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
              >
                Cancel Edit
              </Button>
            ) : null}
            <Button
              disabled={
                !allowPost || isPosting || missingDescription || settingsLoading
              }
              type="submit"
              size="sm"
            >
              {editStatus ? 'Update' : isPosting ? 'Posting...' : 'Post'}
            </Button>
          </div>
        </div>
        {warningMsg ? (
          <div className="text-xs text-destructive mb-3">{warningMsg}</div>
        ) : null}
        {missingDescription ? (
          <div className="text-xs text-destructive mb-3" role="status">
            Add a description to every item, or mark it decorative
          </div>
        ) : null}
        {!replyStatus && postExtension.fitnessFile ? (
          <div className="mb-3 flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <Activity className="size-4 text-muted-foreground" />
              <span className="shrink-0 text-muted-foreground">Fitness:</span>
              <span className="truncate font-medium">
                {postExtension.fitnessFile.file.name}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatFileSize(postExtension.fitnessFile.file.size)}
              </span>
              {postExtension.fitnessFile.uploading ? (
                <span className="shrink-0 text-xs text-muted-foreground">
                  Uploading...
                </span>
              ) : null}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Remove selected fitness file"
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
          disabled={isPosting}
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
          onDetailsRefreshed={(id, details) =>
            setDetailsById((current) => ({ ...current, [id]: details }))
          }
          suggestionsPending={suggestionsPending}
        />
      ) : null}
    </div>
  )
}
