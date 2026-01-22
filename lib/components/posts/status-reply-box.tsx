'use client'

import { Loader2 } from 'lucide-react'
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
import {
  DEFAULT_STATE,
  addAttachment,
  resetExtension,
  setAttachments,
  statusExtensionReducer,
  updateAttachment
} from '@/lib/components/post-box/reducers'
import { UploadMediaButton } from '@/lib/components/post-box/upload-media-button'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { Button } from '@/lib/components/ui/button'
import {
  ActorProfile,
  getMention,
  getMentionFromActorID
} from '@/lib/models/actor'
import { Attachment } from '@/lib/models/attachment'
import { Status, StatusNote, StatusType } from '@/lib/models/status'

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
  const [allowPost, setAllowPost] = useState<boolean>(false)
  const [isPosting, setIsPosting] = useState<boolean>(false)
  const [text, setText] = useState<string>('')
  const [warningMsg, setWarningMsg] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const [postExtension, dispatch] = useReducer(
    statusExtensionReducer,
    DEFAULT_STATE
  )
  const postExtensionRef = useRef(postExtension)

  useEffect(() => {
    postExtensionRef.current = postExtension
  }, [postExtension])

  useEffect(() => {
    return () => {
      postExtensionRef.current.attachments.forEach((attachment) => {
        if (attachment.url.startsWith('blob:')) {
          URL.revokeObjectURL(attachment.url)
        }
      })
    }
  }, [])

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
    if (replyStatus.type !== StatusType.enum.Note) {
      return
    }

    const defaultMessage = getDefaultMessage(profile, replyStatus)
    if (defaultMessage) {
      const [value, start, end] = defaultMessage
      setText(value)
      setAllowPost(true)

      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = start
          textareaRef.current.selectionEnd = end
          textareaRef.current.focus()
        }
      }, 0)
    } else {
      setTimeout(() => {
        textareaRef.current?.focus()
      }, 0)
    }
  }, [profile, replyStatus])

  const onPost = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()

    setAllowPost(false)
    setIsPosting(true)
    setWarningMsg(null)
    const message = text

    try {
      const uploadResults = await Promise.all(
        postExtension.attachments.map(async (attachment) => {
          if (!attachment.file) return attachment

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
            return newAttachment
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
      const attachments = uploadResults.filter((a) =>
        currentAttachmentIds.has(a.id)
      )

      const response = await createNote({
        message,
        replyStatus,
        attachments
      })

      const { status, attachments: storedAttachments } = response
      onPostCreated(status, storedAttachments)
      dispatch(resetExtension())
      setText('')
      setIsPosting(false)
    } catch {
      setIsPosting(false)
      setAllowPost(true)
      alert('Fail to create a reply')
    }
  }

  const onRemoveAttachment = (attachmentIndex: number) => {
    const attachment = postExtension.attachments[attachmentIndex]
    if (attachment.url.startsWith('blob:')) {
      URL.revokeObjectURL(attachment.url)
    }
    dispatch(
      setAttachments([
        ...postExtension.attachments.slice(0, attachmentIndex),
        ...postExtension.attachments.slice(attachmentIndex + 1)
      ])
    )
  }

  const onQuickPost = async (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.metaKey || event.ctrlKey)) return
    if (event.code !== 'Enter') return
    if (!allowPost) return
    if (!formRef.current) return
    await onPost()
  }

  const onTextChange = (value: string) => {
    setText(value)
    if (value.trim().length === 0) {
      setAllowPost(false)
      return
    }
    setAllowPost(true)
  }

  const getPlaceholder = () => {
    if (replyStatus.actor) {
      return `Reply to ${replyStatus.actor.name || replyStatus.actor.username}...`
    }
    return 'Reply...'
  }

  return (
    <div className="mt-4 pt-4 border-t border-border/40">
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
              className="flex min-h-[60px] w-full bg-transparent text-base placeholder:text-muted-foreground focus-visible:outline-none resize-none md:text-sm"
              rows={2}
              onKeyDown={onQuickPost}
              onChange={(e) => onTextChange(e.target.value)}
              name="message"
              placeholder={getPlaceholder()}
              value={text}
            />

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
              <UploadMediaButton
                isMediaUploadEnabled={isMediaUploadEnabled}
                attachments={postExtension.attachments}
                onAddAttachment={(attachment) => {
                  dispatch(addAttachment(attachment))
                }}
                onDuplicateError={() =>
                  setWarningMsg('Some files are already selected')
                }
                onUploadStart={() => setWarningMsg(null)}
              />
              <div className="flex items-center gap-2 ml-auto">
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
