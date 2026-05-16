import { Activity, AlertTriangle, BarChart3, Loader2, X } from 'lucide-react'
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
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkBreaks from 'remark-breaks'
import sanitizeHtml from 'sanitize-html'

import {
  createNote,
  createPoll,
  deleteFitnessFile,
  updateNote,
  uploadAttachment,
  uploadFitnessFile
} from '@/lib/client'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { Button } from '@/lib/components/ui/button'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '@/lib/components/ui/tabs'
import {
  ActorProfile,
  getMention,
  getMentionFromActorID
} from '@/lib/types/domain/actor'
import { Attachment, PostBoxAttachment } from '@/lib/types/domain/attachment'
import {
  EditableStatus,
  Status,
  StatusNote,
  StatusType
} from '@/lib/types/domain/status'
import { formatFileSize } from '@/lib/utils/formatFileSize'
import { getVisibility } from '@/lib/utils/getVisibility'
import { SANITIZED_OPTION } from '@/lib/utils/text/sanitizeText'
import { urlToId } from '@/lib/utils/urlToId'

import { Duration, PollChoices } from './poll-choices'
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
  const [currentTab, setCurrentTab] = useState<string>('write')
  const [text, setText] = useState<string>('')
  const [warningMsg, setWarningMsg] = useState<string | null>(null)
  const postBoxRef = useRef<HTMLTextAreaElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const textRef = useRef(text)
  const fitnessCleanupInFlightRef = useRef<{
    uploadedId: string
    promise: Promise<boolean>
  } | null>(null)

  const [postExtension, dispatch] = useReducer(
    statusExtensionReducer,
    DEFAULT_STATE
  )
  const postExtensionRef = useRef(postExtension)

  const getEditAttachmentIds = (attachments: PostBoxAttachment[]) =>
    attachments.map((attachment) => attachment.id)

  const getOriginalEditAttachmentIds = () =>
    editStatus?.attachments.map(
      (attachment) => attachment.mediaId ?? attachment.id
    ) ?? []

  const hasAttachmentListChanged = (attachments: PostBoxAttachment[]) => {
    const originalIds = getOriginalEditAttachmentIds()
    const currentIds = getEditAttachmentIds(attachments)
    return (
      originalIds.length !== currentIds.length ||
      originalIds.some((id, index) => id !== currentIds[index])
    )
  }

  const getOriginalEditText = () =>
    editStatus ? sanitizeHtml(editStatus.text, { allowedTags: [] }) : ''

  const isEditDirty = ({
    nextText = textRef.current,
    nextContentWarning = postExtensionRef.current.contentWarningVisible
      ? postExtensionRef.current.contentWarning
      : '',
    nextAttachments = postExtensionRef.current.attachments
  }: {
    nextText?: string
    nextContentWarning?: string
    nextAttachments?: PostBoxAttachment[]
  } = {}) => {
    if (!editStatus) return false

    return (
      nextText !== getOriginalEditText() ||
      nextContentWarning !== (editStatus.summary ?? '') ||
      hasAttachmentListChanged(nextAttachments)
    )
  }

  const getEditAttachmentsFromStatus = (): PostBoxAttachment[] =>
    editStatus?.attachments.map((attachment) => ({
      type: 'upload',
      id: attachment.mediaId ?? attachment.id,
      mediaType: attachment.mediaType,
      url: attachment.url,
      width: attachment.width ?? 0,
      height: attachment.height ?? 0,
      name: attachment.name
    })) ?? []

  useEffect(() => {
    postExtensionRef.current = postExtension
  }, [postExtension])

  useEffect(() => {
    textRef.current = text
  }, [text])

  useEffect(() => {
    return () => {
      postExtensionRef.current.attachments.forEach((attachment) => {
        if (attachment.url.startsWith('blob:')) {
          URL.revokeObjectURL(attachment.url)
        }
      })
    }
  }, [])

  const uploadSelectedAttachments = async () => {
    const uploadResults = await Promise.all(
      postExtension.attachments.map(async (attachment) => {
        if (!attachment.file)
          return {
            originalId: attachment.id,
            uploadedAttachment: attachment
          }

        dispatch(
          updateAttachment(attachment.id, {
            ...attachment,
            isLoading: true
          })
        )

        try {
          const uploaded = await uploadAttachment(attachment.file)
          if (!uploaded) throw new Error()

          if (attachment.url.startsWith('blob:')) {
            URL.revokeObjectURL(attachment.url)
          }

          const newAttachment = {
            ...attachment,
            ...uploaded,
            isLoading: false,
            file: undefined
          }
          dispatch(updateAttachment(attachment.id, newAttachment))
          return {
            originalId: attachment.id,
            uploadedAttachment: newAttachment
          }
        } catch {
          dispatch(
            updateAttachment(attachment.id, {
              ...attachment,
              isLoading: false
            })
          )
          throw new Error(`Fail to upload ${attachment.name}`)
        }
      })
    )

    const currentAttachmentIds = new Set(
      postExtensionRef.current.attachments.map((a) => a.id)
    )
    return uploadResults
      .filter(
        (a) =>
          currentAttachmentIds.has(a.originalId) ||
          currentAttachmentIds.has(a.uploadedAttachment.id)
      )
      .map((a) => a.uploadedAttachment)
  }

  const onPost = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()

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
        const attachments = await uploadSelectedAttachments()
        const currentContentWarning = postExtension.contentWarningVisible
          ? postExtension.contentWarning
          : ''
        const hasTextChanged = message !== getOriginalEditText()
        const hasContentWarningChanged =
          currentContentWarning !== (editStatus.summary ?? '')
        const hasMediaChanged = hasAttachmentListChanged(attachments)
        const updateMessage =
          hasTextChanged && message.trim().length > 0 ? message : undefined
        const updateContentWarning = hasContentWarningChanged
          ? currentContentWarning
          : undefined
        const mediaIds = hasMediaChanged
          ? attachments.map((attachment) => attachment.id)
          : undefined
        await updateNote({
          statusId: urlToId(editStatus.id),
          message: updateMessage,
          contentWarning: updateContentWarning,
          mediaIds
        })
        onPostUpdated({
          ...editStatus,
          text: updateMessage ?? editStatus.text,
          summary:
            updateContentWarning !== undefined
              ? updateContentWarning.trim() || null
              : editStatus.summary,
          attachments: hasMediaChanged
            ? attachments.map((attachment) => ({
                id: attachment.id,
                mediaId: attachment.id,
                actorId: editStatus.actorId,
                statusId: editStatus.id,
                type: 'Document' as const,
                mediaType: attachment.mediaType,
                url: attachment.url,
                width: attachment.width,
                height: attachment.height,
                name: attachment.name ?? '',
                createdAt: Date.now(),
                updatedAt: Date.now()
              }))
            : editStatus.attachments
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

      const attachments = await uploadSelectedAttachments()

      const response = await createNote({
        message,
        contentWarning,
        replyStatus,
        attachments,
        fitnessFileId,
        visibility: postExtension.visibility
      })

      const { status, attachments: storedAttachments } = response
      onPostCreated(status, storedAttachments)
      dispatch(resetExtension())

      setText('')
      setIsPosting(false)
    } catch {
      setIsPosting(false)
      setAllowPost(true)
      alert('Fail to create a post')
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
    dispatch(setAttachments(nextAttachments))
    if (editStatus) {
      setAllowPost(isEditDirty({ nextAttachments }))
    }
  }

  const onRemoveFitnessFile = useCallback(async () => {
    const fitnessFile = postExtensionRef.current.fitnessFile
    if (!fitnessFile) {
      return true
    }

    const clearFitnessFile = () => {
      dispatch(removeFitnessFile())
      postExtensionRef.current = {
        ...postExtensionRef.current,
        fitnessFile: undefined
      }
      setAllowPost(textRef.current.trim().length > 0)
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
      setAllowPost(isEditDirty({ nextText: value }))
      return
    }
    if (value.trim().length === 0) {
      setAllowPost(Boolean(postExtensionRef.current.fitnessFile))
      return
    }
    setAllowPost(true)
  }

  const onContentWarningChange = (value: string) => {
    dispatch(setContentWarning(value))
    if (!editStatus) return

    setAllowPost(isEditDirty({ nextContentWarning: value }))
  }

  const onToggleContentWarning = () => {
    const nextVisible = !postExtension.contentWarningVisible
    dispatch(setContentWarningVisibility(nextVisible))
    if (!editStatus) return

    const nextContentWarning = nextVisible ? postExtension.contentWarning : ''
    setAllowPost(isEditDirty({ nextContentWarning }))
  }

  /**
   * Handle default message in Postbox
   *
   * - If there is no reply, always return empty string
   * - If there is reply, but the reply is current actor, don't append current
   *   actor handle name.
   * - If there is reply, return reply status actor handle name with domain*
   *
   * TODO: Instead of using reply actor, it should be reply mention names
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
      setText(editStatus.text)
      dispatch(setContentWarning(editStatus.summary ?? ''))
      dispatch(setContentWarningVisibility(Boolean(editStatus.summary)))
      dispatch(setAttachments(getEditAttachmentsFromStatus()))
      setAllowPost(false)
      return
    } else {
      setText('')
      dispatch(setContentWarning(''))
      dispatch(setContentWarningVisibility(false))
      dispatch(setAttachments([]))
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
        <div className="flex items-start gap-4 mb-3">
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
            <Tabs value={currentTab} onValueChange={setCurrentTab}>
              {postExtension.contentWarningVisible ? (
                <input
                  type="text"
                  className="mb-3 flex h-9 w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  aria-label="Content warning"
                  name="contentWarning"
                  placeholder="Write your warning here"
                  value={postExtension.contentWarning}
                  onChange={(event) =>
                    onContentWarningChange(event.target.value)
                  }
                />
              ) : null}
              <TabsList className="mb-3">
                <TabsTrigger value="write">Write</TabsTrigger>
                <TabsTrigger value="preview">Preview</TabsTrigger>
              </TabsList>

              <TabsContent value="write" className="mt-0">
                <textarea
                  ref={postBoxRef}
                  className="flex min-h-[120px] w-full bg-transparent px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:outline-none resize-none md:text-sm"
                  rows={5}
                  onKeyDown={onQuickPost}
                  onChange={(e) => onTextChange(e.target.value)}
                  name="message"
                  placeholder="What's on your mind?"
                  value={text}
                />
              </TabsContent>

              <TabsContent value="preview" className="mt-0">
                <div className="flex min-h-[120px] w-full bg-transparent px-3 py-2 text-sm">
                  {text ? (
                    <div className="markdown-content max-w-none">
                      <ReactMarkdown
                        remarkPlugins={[remarkBreaks]}
                        rehypePlugins={[
                          [
                            rehypeSanitize,
                            {
                              tagNames: SANITIZED_OPTION.allowedTags,
                              attributes: SANITIZED_OPTION.allowedAttributes
                            }
                          ]
                        ]}
                      >
                        {text}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-muted-foreground">Nothing to preview</p>
                  )}
                </div>
              </TabsContent>
            </Tabs>
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
        />
        <div className="flex justify-between mb-3">
          <div>
            <VisibilitySelector
              visibility={postExtension.visibility}
              onVisibilityChange={(visibility) =>
                dispatch(setVisibility(visibility))
              }
            />
            <Button
              type="button"
              variant={
                postExtension.contentWarningVisible ? 'secondary' : 'link'
              }
              aria-label={
                postExtension.contentWarningVisible
                  ? 'Remove content warning'
                  : 'Add content warning'
              }
              title="Content warning"
              onClick={onToggleContentWarning}
            >
              <AlertTriangle className="size-4" />
            </Button>
            <Button
              type="button"
              variant="link"
              onClick={() =>
                dispatch(setPollVisibility(!postExtension.poll.showing))
              }
            >
              <BarChart3 className="size-4" />
            </Button>
            {!replyStatus ? (
              <UploadFitnessFileButton
                disabled={isPosting}
                onFileSelected={(file) => {
                  setWarningMsg(null)
                  dispatch(setFitnessFile(file))
                  setAllowPost(true)
                }}
                onError={(message) => setWarningMsg(message)}
              />
            ) : null}
            <UploadMediaButton
              isMediaUploadEnabled={isMediaUploadEnabled}
              attachments={postExtension.attachments}
              onAddAttachment={(attachment) => {
                dispatch(addAttachment(attachment))
                if (editStatus) {
                  setAllowPost(
                    isEditDirty({
                      nextAttachments: [
                        ...postExtensionRef.current.attachments,
                        attachment
                      ]
                    })
                  )
                }
              }}
              onDuplicateError={() =>
                setWarningMsg('Some files are already selected')
              }
              onUploadStart={() => setWarningMsg(null)}
              onBeforeAddAttachments={onRemoveFitnessFile}
            />
          </div>
          <div>
            {editStatus ? (
              <Button
                className="mr-2"
                type="button"
                variant="destructive"
                onClick={onDiscardEdit}
              >
                Cancel Edit
              </Button>
            ) : null}
            <Button disabled={!allowPost || isPosting} type="submit">
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
              <div
                className="w-full aspect-square bg-border bg-center bg-cover cursor-pointer relative"
                key={item.id}
                role="button"
                aria-label={`Remove media ${item.name ?? item.id}`}
                tabIndex={0}
                style={{
                  backgroundImage: `url("${item.posterUrl || item.url}")`
                }}
                onClick={() => onRemoveAttachment(index)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onRemoveAttachment(index)
                  }
                }}
              >
                {item.isLoading ? (
                  <div className="absolute inset-0 bg-background/50 flex items-center justify-center">
                    <Loader2 className="animate-spin text-primary" />
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </form>
    </div>
  )
}
