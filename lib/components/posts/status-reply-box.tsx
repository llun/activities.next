'use client'

import { AlertTriangle, Loader2 } from 'lucide-react'
import {
  FC,
  FormEvent,
  KeyboardEvent,
  useEffect,
  useReducer,
  useRef,
  useState
} from 'react'

import { createNote, uploadAttachment } from '@/lib/client'
import { useInstanceLimits } from '@/lib/components/instance-limits'
import {
  addAttachment,
  createDefaultState,
  resetExtension,
  setAttachments,
  setContentWarning,
  setContentWarningVisibility,
  statusExtensionReducer,
  updateAttachment
} from '@/lib/components/post-box/reducers'
import { UploadMediaButton } from '@/lib/components/post-box/upload-media-button'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { Button } from '@/lib/components/ui/button'
import { useAutoResizeTextarea } from '@/lib/hooks/useAutoResizeTextarea'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import { Status } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'
import { MastodonVisibility } from '@/lib/utils/getVisibility'

import {
  PreparedReplyDraft,
  ReplyMentionMode,
  ReplyTargetPreview,
  prepareReplyDraft
} from './replyDraft'

interface Props {
  profile: ActorProfile
  replyStatus: Status
  isMediaUploadEnabled?: boolean
  onCancel: () => void
  onPostCreated: (status: Status, attachments: Attachment[]) => void
}

export const StatusReplyBox: FC<Props> = ({
  profile,
  replyStatus,
  isMediaUploadEnabled,
  onCancel,
  onPostCreated
}) => {
  // The instance's configured status length (admin setting posts.maxCharacters).
  // The reply endpoint enforces it too, so without this the reply box would let
  // a draft grow past the limit and only fail on submit.
  const { maxStatusCharacters, maxMediaAttachments } = useInstanceLimits()
  const [isPosting, setIsPosting] = useState<boolean>(false)
  const [text, setText] = useState<string>('')
  const [warningMsg, setWarningMsg] = useState<string | null>(null)
  const [mentionMode, setMentionMode] = useState<ReplyMentionMode>('all')
  const [targetPreview, setTargetPreview] = useState<ReplyTargetPreview | null>(
    null
  )
  const [inheritedVisibility, setInheritedVisibility] =
    useState<MastodonVisibility>('public')
  const [inheritedLanguage, setInheritedLanguage] = useState<
    string | undefined
  >(undefined)
  const [mentionsSummary, setMentionsSummary] = useState<
    PreparedReplyDraft['mentions']
  >({
    author: null,
    others: [],
    all: []
  })

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useAutoResizeTextarea(textareaRef, text)
  const formRef = useRef<HTMLFormElement>(null)
  const isSubmittingRef = useRef<boolean>(false)
  const initializedStatusIdRef = useRef<string | null>(null)
  const userHasEditedTextRef = useRef<boolean>(false)

  const [postExtension, dispatch] = useReducer(
    statusExtensionReducer,
    undefined,
    createDefaultState
  )
  const postExtensionRef = useRef(postExtension)
  const removedAttachmentIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    postExtensionRef.current = postExtension
  }, [postExtension])

  // Allow posting if text has content OR if there are media attachments
  // (permitting valid attachment-only replies per repository guidelines).
  const hasContent =
    text.trim().length > 0 || postExtension.attachments.length > 0
  const allowPost = hasContent && text.length <= maxStatusCharacters

  useEffect(() => {
    return () => {
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

  // Initialize draft helper: compute mentions, CW, visibility, declared language,
  // and target preview. Do NOT overwrite an edited draft when unrelated status props refresh.
  useEffect(() => {
    if (initializedStatusIdRef.current === replyStatus.id) {
      return
    }

    initializedStatusIdRef.current = replyStatus.id
    userHasEditedTextRef.current = false

    const draft = prepareReplyDraft({
      targetStatus: replyStatus,
      currentViewer: profile,
      mentionMode
    })

    setTargetPreview(draft.targetPreview)
    setInheritedVisibility(draft.visibility)
    setInheritedLanguage(draft.language)
    setMentionsSummary(draft.mentions)

    setText(draft.initialText)
    if (draft.isSpoilerVisible) {
      dispatch(setContentWarningVisibility(true))
      dispatch(setContentWarning(draft.spoilerText))
    } else {
      dispatch(setContentWarningVisibility(false))
      dispatch(setContentWarning(''))
    }

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = draft.cursorPosition
        textareaRef.current.selectionEnd = draft.cursorPosition
        textareaRef.current.focus()
      }
    }, 0)
  }, [profile, replyStatus, mentionMode])

  const handleMentionModeChange = (mode: ReplyMentionMode) => {
    setMentionMode(mode)
    if (!userHasEditedTextRef.current) {
      const draft = prepareReplyDraft({
        targetStatus: replyStatus,
        currentViewer: profile,
        mentionMode: mode
      })
      setText(draft.initialText)
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = draft.cursorPosition
          textareaRef.current.selectionEnd = draft.cursorPosition
          textareaRef.current.focus()
        }
      }, 0)
    }
  }

  const onPost = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()

    // Double-submit prevention: synchronously reject if already submitting
    if (isSubmittingRef.current || isPosting) {
      return
    }
    isSubmittingRef.current = true
    setIsPosting(true)
    setWarningMsg(null)
    removedAttachmentIdsRef.current.clear()

    const message = text
    const contentWarning = postExtension.contentWarningVisible
      ? postExtension.contentWarning
      : undefined

    try {
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
            const uploaded = attachment.posterFile
              ? await uploadAttachment(attachment.file, attachment.posterFile)
              : await uploadAttachment(attachment.file)
            if (!uploaded) throw new Error()

            if (attachment.url.startsWith('blob:')) {
              URL.revokeObjectURL(attachment.url)
            }
            if (attachment.posterUrl?.startsWith('blob:')) {
              URL.revokeObjectURL(attachment.posterUrl)
            }

            const newAttachment = {
              ...attachment,
              ...uploaded,
              isLoading: false,
              file: undefined,
              posterFile: undefined
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
            throw new Error(
              `Fail to upload ${attachment.file?.name ?? attachment.name ?? 'file'}`
            )
          }
        })
      )

      const currentAttachmentIds = new Set(
        postExtensionRef.current.attachments.map((a) => a.id)
      )
      const removedAttachmentIds = removedAttachmentIdsRef.current
      const attachments = uploadResults
        .filter(
          (a) =>
            !removedAttachmentIds.has(a.originalId) &&
            !removedAttachmentIds.has(a.uploadedAttachment.id) &&
            (currentAttachmentIds.has(a.originalId) ||
              currentAttachmentIds.has(a.uploadedAttachment.id))
        )
        .map((a) => a.uploadedAttachment)

      const response = await createNote({
        message,
        contentWarning,
        replyStatus,
        inReplyToId: replyStatus.id,
        visibility: inheritedVisibility,
        language: inheritedLanguage,
        attachments
      })

      const { status, attachments: storedAttachments } = response
      onPostCreated(status, storedAttachments)
      dispatch(resetExtension())
      removedAttachmentIdsRef.current.clear()
      setText('')
      isSubmittingRef.current = false
      setIsPosting(false)
    } catch (error) {
      isSubmittingRef.current = false
      setIsPosting(false)
      // Surface the server's message without wiping user draft, CW, or attachments.
      setWarningMsg(
        error instanceof Error && error.message
          ? error.message
          : 'Fail to create a reply'
      )
    }
  }

  const onRemoveAttachment = (attachmentIndex: number) => {
    const attachment = postExtension.attachments[attachmentIndex]
    if (!attachment) return

    removedAttachmentIdsRef.current.add(attachment.id)

    if (attachment.url.startsWith('blob:')) {
      URL.revokeObjectURL(attachment.url)
    }
    if (attachment.posterUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(attachment.posterUrl)
    }

    const nextAttachments = [
      ...postExtension.attachments.slice(0, attachmentIndex),
      ...postExtension.attachments.slice(attachmentIndex + 1)
    ]

    postExtensionRef.current = {
      ...postExtensionRef.current,
      attachments: nextAttachments
    }

    dispatch(setAttachments(nextAttachments))
  }

  const onQuickPost = async (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.metaKey || event.ctrlKey)) return
    if (event.code !== 'Enter') return
    if (!allowPost || isSubmittingRef.current || isPosting) return
    if (!formRef.current) return
    event.preventDefault()
    await onPost()
  }

  const onTextChange = (value: string) => {
    userHasEditedTextRef.current = true
    setText(value)
  }

  const getPlaceholder = () => {
    if (targetPreview) {
      return `Reply to ${targetPreview.authorName}...`
    }
    return 'Reply...'
  }

  return (
    <div className="mt-4 pt-4 border-t border-border/40">
      {targetPreview ? (
        <div
          data-testid="reply-target-preview"
          className="mb-3 rounded-lg border border-border/60 bg-muted/30 p-2.5 text-xs"
        >
          <div className="flex items-center gap-2 font-medium text-foreground">
            <span>Replying to {targetPreview.authorName}</span>
            <span className="text-muted-foreground">
              {targetPreview.authorHandle}
            </span>
            {targetPreview.isPoll ? (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary font-semibold">
                Poll
              </span>
            ) : null}
          </div>
          {targetPreview.spoilerText ? (
            <div className="mt-1 font-medium text-amber-600 dark:text-amber-400">
              CW: {targetPreview.spoilerText}
            </div>
          ) : null}
          {targetPreview.textSnippet ? (
            <div className="mt-1 line-clamp-2 text-muted-foreground">
              {targetPreview.textSnippet}
            </div>
          ) : null}
        </div>
      ) : null}

      {mentionsSummary.others.length > 0 ? (
        <div className="flex items-center gap-1.5 mb-2.5 text-xs text-muted-foreground">
          <span className="text-[11px] font-medium mr-1">Mentions:</span>
          <button
            type="button"
            onClick={() => handleMentionModeChange('all')}
            className={cn(
              'rounded-full px-2.5 py-0.5 text-xs transition-colors',
              mentionMode === 'all'
                ? 'bg-primary text-primary-foreground font-medium'
                : 'bg-muted hover:bg-muted/80 text-foreground'
            )}
          >
            All ({mentionsSummary.all.length})
          </button>
          <button
            type="button"
            onClick={() => handleMentionModeChange('author-first')}
            className={cn(
              'rounded-full px-2.5 py-0.5 text-xs transition-colors',
              mentionMode === 'author-first'
                ? 'bg-primary text-primary-foreground font-medium'
                : 'bg-muted hover:bg-muted/80 text-foreground'
            )}
          >
            Author first
          </button>
          <button
            type="button"
            onClick={() => handleMentionModeChange('author-only')}
            className={cn(
              'rounded-full px-2.5 py-0.5 text-xs transition-colors',
              mentionMode === 'author-only'
                ? 'bg-primary text-primary-foreground font-medium'
                : 'bg-muted hover:bg-muted/80 text-foreground'
            )}
          >
            Author only
          </button>
        </div>
      ) : null}

      <form ref={formRef} onSubmit={onPost}>
        <div className="flex items-start gap-3">
          <Avatar className="size-8 shrink-0">
            <AvatarImage
              src={profile.iconUrl}
              alt={profile.name ?? profile.username}
            />
            <AvatarFallback className="text-xs">
              {(profile.name ?? profile.username).charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <textarea
              ref={textareaRef}
              className="flex min-h-[60px] max-h-[min(320px,40dvh)] w-full resize-none bg-transparent text-base placeholder:text-muted-foreground focus-visible:outline-none field-sizing-content overflow-y-auto md:text-sm"
              rows={2}
              onKeyDown={onQuickPost}
              onChange={(e) => onTextChange(e.target.value)}
              name="message"
              placeholder={getPlaceholder()}
              value={text}
            />

            {postExtension.contentWarningVisible ? (
              <input
                type="text"
                className="mt-2 flex h-8 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                aria-label="Content warning"
                name="contentWarning"
                placeholder="Write your warning here"
                value={postExtension.contentWarning}
                onChange={(event) =>
                  dispatch(setContentWarning(event.target.value))
                }
              />
            ) : null}

            {postExtension.attachments.length > 0 && (
              <div className="grid gap-2 grid-cols-8 mt-2">
                {postExtension.attachments.map((item, index) => (
                  <div
                    className="w-full aspect-square bg-border bg-center bg-cover cursor-pointer relative rounded"
                    key={item.id}
                    style={{
                      backgroundImage: `url("${item.posterUrl || item.url}")`
                    }}
                    onClick={() => onRemoveAttachment(index)}
                  >
                    {item.isLoading ? (
                      <div className="absolute inset-0 bg-background/50 flex items-center justify-center rounded">
                        <Loader2 className="animate-spin text-primary size-4" />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            {warningMsg ? (
              <div className="text-xs text-destructive mt-2">{warningMsg}</div>
            ) : null}

            <div className="flex items-center mt-2">
              <Button
                type="button"
                variant={
                  postExtension.contentWarningVisible ? 'secondary' : 'link'
                }
                size="icon-sm"
                aria-label={
                  postExtension.contentWarningVisible
                    ? 'Remove content warning'
                    : 'Add content warning'
                }
                title="Content warning"
                onClick={() =>
                  dispatch(
                    setContentWarningVisibility(
                      !postExtension.contentWarningVisible
                    )
                  )
                }
              >
                <AlertTriangle className="size-4" />
              </Button>
              <UploadMediaButton
                isMediaUploadEnabled={isMediaUploadEnabled}
                attachments={postExtension.attachments}
                onAddAttachment={(attachment) => {
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
                  postExtensionRef.current = {
                    ...postExtensionRef.current,
                    attachments: [
                      ...postExtensionRef.current.attachments,
                      attachment
                    ]
                  }
                  dispatch(addAttachment(attachment, maxMediaAttachments))
                }}
                onDuplicateError={() =>
                  setWarningMsg('Some files are already selected')
                }
                onFilesRejected={(message) => setWarningMsg(message)}
                onUploadStart={() => setWarningMsg(null)}
              />
              <div className="flex items-center gap-2 ml-auto">
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
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onCancel}
                >
                  Cancel
                </Button>
                <Button
                  disabled={!allowPost || isPosting}
                  type="submit"
                  size="sm"
                >
                  {isPosting ? 'Posting...' : 'Post'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
