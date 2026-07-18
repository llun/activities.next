import {
  Activity,
  AlertTriangle,
  BarChart3,
  Eye,
  Loader2,
  X
} from 'lucide-react'
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
  deleteFitnessFile,
  getCustomEmojis,
  getDefaultQuotePolicy,
  updateNote,
  uploadAttachment,
  uploadFitnessFile
} from '@/lib/client'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { Button } from '@/lib/components/ui/button'
import {
  ActorProfile,
  getMention,
  getMentionFromActorID
} from '@/lib/types/domain/actor'
import {
  Attachment,
  PostBoxAttachment,
  isFitnessAttachment
} from '@/lib/types/domain/attachment'
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

import { EmojiPickerButton } from './emoji-picker-button'
import { Duration, PollChoices } from './poll-choices'
import { QuoteApprovalPolicySelector } from './quote-approval-policy-selector'
import {
  DEFAULT_STATE,
  addAttachment,
  addPollChoice,
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

interface Props {
  host: string
  profile: ActorProfile
  replyStatus?: Status
  editStatus?: EditableStatus
  isMediaUploadEnabled?: boolean
  onDiscardReply: () => void
  onPostCreated: (status: Status, attachments: Attachment[]) => void
  onPostUpdated: (status: Status) => void
  onDiscardEdit: () => void
}

const MAX_STATUS_LENGTH = 500

const getEditableStatusText = (status: EditableStatus) => status.text

const isEditableStatusMediaAttachment = (
  attachment: Attachment
): attachment is Attachment & { mediaId: string } =>
  Boolean(attachment.mediaId) && !isFitnessAttachment(attachment)

const getEditableStatusAttachments = (
  status: EditableStatus
): PostBoxAttachment[] =>
  status.attachments.flatMap((attachment) => {
    if (!isEditableStatusMediaAttachment(attachment)) return []

    return [
      {
        type: 'upload',
        id: attachment.mediaId,
        mediaType: attachment.mediaType,
        url: attachment.url,
        width: attachment.width ?? 0,
        height: attachment.height ?? 0,
        name: attachment.name
      }
    ]
  })

const getPreservedStatusAttachments = (attachments: Attachment[]) =>
  attachments.filter(
    (attachment) => !isEditableStatusMediaAttachment(attachment)
  )

const getAttachmentIds = (attachments: Pick<PostBoxAttachment, 'id'>[]) =>
  attachments.map((attachment) => attachment.id)

const areAttachmentIdsEqualInOrder = (
  current: Pick<PostBoxAttachment, 'id'>[],
  baseline: Pick<PostBoxAttachment, 'id'>[]
) => {
  const currentIds = getAttachmentIds(current)
  const baselineIds = getAttachmentIds(baseline)
  if (currentIds.length !== baselineIds.length) return false
  return currentIds.every((id, index) => id === baselineIds[index])
}

const isWithinLengthLimit = (value: string) => value.length <= MAX_STATUS_LENGTH

const hasNewPostContent = (
  value: string,
  extension: { attachments: PostBoxAttachment[]; fitnessFile?: unknown }
) =>
  isWithinLengthLimit(value) &&
  (value.trim().length > 0 ||
    extension.attachments.length > 0 ||
    Boolean(extension.fitnessFile))

const hasEditPostContent = (
  status: EditableStatus,
  value: string,
  extension: { attachments: PostBoxAttachment[] }
) =>
  isWithinLengthLimit(value) &&
  (value.trim().length > 0 ||
    extension.attachments.length > 0 ||
    getPreservedStatusAttachments(status.attachments).length > 0)

type UpdateNoteResponse = Awaited<ReturnType<typeof updateNote>>
type UpdateNoteMediaAttachment = UpdateNoteResponse['mediaAttachments'][number]

const getTimestamp = (value: unknown, fallback: number) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const timestamp = Date.parse(value)
    return Number.isNaN(timestamp) ? fallback : timestamp
  }
  if (value instanceof Date) {
    const timestamp = value.getTime()
    return Number.isNaN(timestamp) ? fallback : timestamp
  }
  return fallback
}

const getMediaAttachmentDimensions = (
  mediaAttachment: UpdateNoteMediaAttachment,
  fallback?: PostBoxAttachment
) => {
  const meta = (
    'meta' in mediaAttachment ? mediaAttachment.meta : undefined
  ) as
    | {
        original?: { width?: number; height?: number }
        width?: number
        height?: number
      }
    | null
    | undefined

  return {
    width: meta?.original?.width ?? meta?.width ?? fallback?.width,
    height: meta?.original?.height ?? meta?.height ?? fallback?.height
  }
}

const getMediaTypeFromMastodonAttachment = (
  attachment: UpdateNoteMediaAttachment
) => {
  switch (attachment.type) {
    case 'image':
      return 'image/jpeg'
    case 'gifv':
    case 'video':
      return 'video/mp4'
    case 'audio':
      return 'audio/mpeg'
    default:
      return 'application/octet-stream'
  }
}

const getStatusAttachmentsFromUpdateResponse = ({
  actorId,
  existingAttachments,
  mediaAttachments,
  statusId,
  uploadedAttachments,
  updatedAt
}: {
  actorId: string
  existingAttachments: Attachment[]
  mediaAttachments: UpdateNoteMediaAttachment[]
  statusId: string
  uploadedAttachments: PostBoxAttachment[]
  updatedAt: number
}): Attachment[] => {
  const updatedMediaAttachments: Attachment[] = mediaAttachments.map(
    (mediaAttachment, index) => {
      // Mastodon returns media attachments in the submitted order; keep this
      // order-sensitive pairing so Attachment.id comes from the server while
      // mediaId and fallback metadata come from the uploaded media ids.
      const uploadedAttachment = uploadedAttachments[index]
      const existingAttachment = existingAttachments.find(
        (attachment) =>
          attachment.id === mediaAttachment.id ||
          attachment.mediaId === uploadedAttachment?.id ||
          attachment.url === mediaAttachment.url
      )
      const dimensions = getMediaAttachmentDimensions(
        mediaAttachment,
        uploadedAttachment
      )
      const attachmentCreatedAt = existingAttachment?.createdAt ?? updatedAt

      return {
        id: mediaAttachment.id,
        actorId,
        statusId,
        type: 'Document',
        mediaType:
          existingAttachment?.mediaType ??
          uploadedAttachment?.mediaType ??
          getMediaTypeFromMastodonAttachment(mediaAttachment),
        url: mediaAttachment.url,
        width: dimensions.width ?? existingAttachment?.width,
        height: dimensions.height ?? existingAttachment?.height,
        name:
          mediaAttachment.description ??
          existingAttachment?.name ??
          uploadedAttachment?.name ??
          '',
        mediaId: existingAttachment
          ? (existingAttachment.mediaId ?? null)
          : (uploadedAttachment?.id ?? null),
        createdAt: attachmentCreatedAt,
        updatedAt
      }
    }
  )

  const preservedAttachments: Attachment[] = getPreservedStatusAttachments(
    existingAttachments
  )
    .filter(
      (attachment) =>
        !mediaAttachments.some(
          (mediaAttachment) =>
            mediaAttachment.id === attachment.id ||
            mediaAttachment.url === attachment.url
        )
    )
    .map((attachment) => ({
      ...attachment,
      statusId,
      updatedAt
    }))

  return [...updatedMediaAttachments, ...preservedAttachments]
}

export const PostBox: FC<Props> = ({
  host,
  profile,
  replyStatus,
  editStatus,
  isMediaUploadEnabled,
  onPostCreated,
  onPostUpdated,
  onDiscardReply,
  onDiscardEdit
}) => {
  const [allowPost, setAllowPost] = useState<boolean>(false)
  const [isPosting, setIsPosting] = useState<boolean>(false)
  const [showPreview, setShowPreview] = useState<boolean>(false)
  const [text, setText] = useState<string>('')
  const [warningMsg, setWarningMsg] = useState<string | null>(null)
  const postBoxRef = useRef<HTMLTextAreaElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const textRef = useRef(text)
  const submitInFlightRef = useRef(false)
  const fitnessCleanupInFlightRef = useRef<{
    uploadedId: string
    promise: Promise<boolean>
  } | null>(null)

  const [postExtension, dispatch] = useReducer(
    statusExtensionReducer,
    DEFAULT_STATE
  )
  const postExtensionRef = useRef(postExtension)
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
    (value: string): Tag[] =>
      getEmojiTags(value, customEmojis).map((emojiTag, index) => ({
        id: `preview-${index}`,
        statusId: 'preview',
        type: 'emoji' as const,
        name: emojiTag.name,
        value: emojiTag.value,
        createdAt: 0,
        updatedAt: 0
      })),
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

  const isEditDirty = (
    value = textRef.current,
    extension = postExtensionRef.current
  ) => {
    if (!editStatus) return false

    const contentWarning = extension.contentWarningVisible
      ? extension.contentWarning
      : ''
    return (
      value !== getEditableStatusText(editStatus) ||
      contentWarning !== (editStatus.summary ?? '') ||
      !areAttachmentIdsEqualInOrder(
        extension.attachments,
        getEditableStatusAttachments(editStatus)
      )
    )
  }

  const isEditSubmittable = (
    value = textRef.current,
    extension = postExtensionRef.current
  ) => {
    if (!editStatus) return false

    return (
      isEditDirty(value, extension) &&
      hasEditPostContent(editStatus, value, extension)
    )
  }

  useEffect(() => {
    return () => {
      postExtensionRef.current.attachments.forEach((attachment) => {
        if (attachment.url.startsWith('blob:')) {
          URL.revokeObjectURL(attachment.url)
        }
      })
    }
  }, [])

  const uploadMediaAttachments = async () => {
    const attachmentsToUpload = postExtensionRef.current.attachments

    const uploadResults = await Promise.all(
      attachmentsToUpload.map(async (attachment) => {
        if (!attachment.file)
          return {
            originalId: attachment.id,
            uploadedAttachment: attachment
          }

        const loadingAttachment = {
          ...attachment,
          isLoading: true
        }
        postExtensionRef.current = {
          ...postExtensionRef.current,
          attachments: postExtensionRef.current.attachments.map((item) =>
            item.id === attachment.id ? loadingAttachment : item
          )
        }
        dispatch(updateAttachment(attachment.id, loadingAttachment))

        try {
          const uploaded = await uploadAttachment(attachment.file)
          if (!uploaded) throw new Error()

          // Revoke the blob URL after successful upload
          if (attachment.url.startsWith('blob:')) {
            URL.revokeObjectURL(attachment.url)
          }

          const newAttachment = {
            ...attachment,
            ...uploaded,
            isLoading: false,
            file: undefined
          }
          postExtensionRef.current = {
            ...postExtensionRef.current,
            attachments: postExtensionRef.current.attachments.map((item) =>
              item.id === attachment.id ? newAttachment : item
            )
          }
          dispatch(updateAttachment(attachment.id, newAttachment))
          return {
            originalId: attachment.id,
            uploadedAttachment: newAttachment
          }
        } catch (error) {
          const restoredAttachment = {
            ...attachment,
            isLoading: false
          }
          postExtensionRef.current = {
            ...postExtensionRef.current,
            attachments: postExtensionRef.current.attachments.map((item) =>
              item.id === attachment.id ? restoredAttachment : item
            )
          }
          dispatch(updateAttachment(attachment.id, restoredAttachment))
          const reason =
            error instanceof Error && error.message ? `: ${error.message}` : ''
          throw new Error(`Fail to upload ${attachment.name}${reason}`, {
            cause: error
          })
        }
      })
    )

    // Filter out attachments that were removed during upload
    const currentAttachmentIds = new Set(
      postExtensionRef.current.attachments.map((a) => a.id)
    )
    return uploadResults
      .filter((a) => {
        return (
          currentAttachmentIds.has(a.originalId) ||
          currentAttachmentIds.has(a.uploadedAttachment.id)
        )
      })
      .map((a) => a.uploadedAttachment)
  }

  const onPost = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    if (!allowPost) return
    if (!isWithinLengthLimit(textRef.current)) return
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
        setIsPosting(false)
        return
      }

      if (editStatus) {
        const attachments = await uploadMediaAttachments()
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

        if (
          updateMessage === undefined &&
          updateContentWarning === undefined &&
          updateAttachments === undefined
        ) {
          setIsPosting(false)
          return
        }

        const updateResponse = await updateNote({
          statusId: editStatus.id,
          message: updateMessage,
          contentWarning: updateContentWarning,
          attachments: updateAttachments
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

      const response = await createNote({
        message,
        contentWarning,
        replyStatus,
        attachments,
        fitnessFileId,
        visibility: postExtension.visibility,
        quoteApprovalPolicy: postExtension.quoteApprovalPolicy
      })

      const { status, attachments: storedAttachments } = response
      onPostCreated(status, storedAttachments)
      dispatch(resetExtension())
      // resetExtension() drops the policy back to the DEFAULT_STATE 'public';
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

  const onRemoveAttachment = (attachmentIndex: number) => {
    const attachment = postExtension.attachments[attachmentIndex]
    if (attachment.url.startsWith('blob:')) {
      URL.revokeObjectURL(attachment.url)
    }
    const nextAttachments = [
      ...postExtension.attachments.slice(0, attachmentIndex),
      ...postExtension.attachments.slice(attachmentIndex + 1)
    ]
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
    setAllowPost(hasNewPostContent(textRef.current, nextExtension))
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
      setAllowPost(hasNewPostContent(textRef.current, nextExtension))
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
  }, [])

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
    setAllowPost(hasNewPostContent(value, postExtensionRef.current))
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
    if (editStatus) {
      const editText = getEditableStatusText(editStatus)
      const attachments = getEditableStatusAttachments(editStatus)
      const nextExtension = {
        ...DEFAULT_STATE,
        attachments,
        contentWarning: editStatus.summary ?? '',
        contentWarningVisible: Boolean(editStatus.summary)
      }
      postExtensionRef.current = nextExtension
      textRef.current = editText
      setText(editText)
      dispatch(setAttachments(attachments))
      dispatch(setContentWarning(editStatus.summary ?? ''))
      dispatch(setContentWarningVisibility(Boolean(editStatus.summary)))
      setAllowPost(false)
      return
    } else {
      setText('')
      textRef.current = ''
      postExtensionRef.current = DEFAULT_STATE
      dispatch(resetExtension())
      setAllowPost(false)
    }

    if (!replyStatus) {
      // Reset visibility to default when not replying
      dispatch(setVisibility('public'))
      return
    }

    // Initialize visibility from reply status to inherit parent visibility
    const replyVisibility = getVisibility(replyStatus.to, replyStatus.cc)
    dispatch(setVisibility(replyVisibility))

    if (replyStatus.type !== StatusType.enum.Note) {
      return
    }

    const defaultMessage = getDefaultMessage(profile, replyStatus)
    if (!defaultMessage) {
      return
    }

    const [value, start, end] = defaultMessage
    setText(value)
    setAllowPost(true)

    // We need to wait for render to focus and set selection
    // Using setTimeout as a simple way to wait for next tick after render
    setTimeout(() => {
      if (postBoxRef.current) {
        postBoxRef.current.selectionStart = start
        postBoxRef.current.selectionEnd = end
        postBoxRef.current.focus()
      }
    }, 0)
  }, [profile, replyStatus, editStatus])

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
              className="flex min-h-[72px] w-full resize-none bg-transparent text-base leading-relaxed placeholder:text-muted-foreground focus-visible:outline-none md:text-sm"
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
                {text ? (
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
          onAddChoice={() => dispatch(addPollChoice)}
          onRemoveChoice={(index) => dispatch(removePollChoice(index))}
          onChooseDuration={(durationInSeconds: Duration) =>
            dispatch(setPollDurationInSeconds(durationInSeconds))
          }
          onPollTypeChange={(pollType) => dispatch(setPollType(pollType))}
          onRemove={() => dispatch(setPollVisibility(false))}
        />
        <div className="mt-3 flex flex-wrap items-center gap-y-2 border-t pt-3">
          <div className="flex flex-wrap items-center gap-1">
            <UploadMediaButton
              isMediaUploadEnabled={isMediaUploadEnabled}
              attachments={postExtension.attachments}
              onAddAttachment={(attachment) => {
                const nextExtension = {
                  ...postExtensionRef.current,
                  attachments: [
                    ...postExtensionRef.current.attachments,
                    attachment
                  ],
                  fitnessFile: undefined,
                  poll: {
                    ...DEFAULT_STATE.poll
                  }
                }
                postExtensionRef.current = nextExtension
                dispatch(addAttachment(attachment))
                if (editStatus) {
                  setAllowPost(
                    isEditSubmittable(textRef.current, nextExtension)
                  )
                  return
                }
                setAllowPost(hasNewPostContent(textRef.current, nextExtension))
              }}
              onDuplicateError={() =>
                setWarningMsg('Some files are already selected')
              }
              onUploadStart={() => setWarningMsg(null)}
              onBeforeAddAttachments={onRemoveFitnessFile}
            />
            {!replyStatus && !editStatus ? (
              <UploadFitnessFileButton
                disabled={isPosting}
                onFileSelected={(file) => {
                  setWarningMsg(null)
                  postExtensionRef.current.attachments.forEach((attachment) => {
                    if (attachment.url.startsWith('blob:')) {
                      URL.revokeObjectURL(attachment.url)
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
                    hasNewPostContent(textRef.current, nextExtension)
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
              disabled={isPosting}
              title={postExtension.poll.showing ? 'Remove poll' : 'Add poll'}
              className={cn(
                postExtension.poll.showing
                  ? 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() =>
                dispatch(setPollVisibility(!postExtension.poll.showing))
              }
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
              disabled={isPosting}
            />
            <QuoteApprovalPolicySelector
              value={postExtension.quoteApprovalPolicy}
              onChange={(policy) => dispatch(setQuoteApprovalPolicy(policy))}
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
                text.length > MAX_STATUS_LENGTH
                  ? 'text-destructive'
                  : 'text-muted-foreground'
              )}
            >
              {MAX_STATUS_LENGTH - text.length}
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
            <Button disabled={!allowPost || isPosting} type="submit" size="sm">
              {editStatus ? 'Update' : isPosting ? 'Posting...' : 'Post'}
            </Button>
          </div>
        </div>
        {warningMsg ? (
          <div className="text-xs text-destructive mb-3">{warningMsg}</div>
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
        <div className="grid gap-4 grid-cols-8">
          {postExtension.attachments.map((item, index) => {
            return (
              <button
                type="button"
                aria-label={`Remove media ${item.name ?? index + 1}`}
                className="w-full aspect-square bg-border bg-center bg-cover cursor-pointer relative"
                key={item.id}
                style={{
                  backgroundImage: `url("${item.posterUrl || item.url}")`
                }}
                onClick={() => onRemoveAttachment(index)}
              >
                {item.isLoading ? (
                  <div className="absolute inset-0 bg-background/50 flex items-center justify-center">
                    <Loader2 className="animate-spin text-primary" />
                  </div>
                ) : null}
              </button>
            )
          })}
        </div>
      </form>
    </div>
  )
}
