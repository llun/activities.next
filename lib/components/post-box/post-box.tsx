import { BarChart3, Loader2 } from 'lucide-react'
import {
  FC,
  FormEvent,
  KeyboardEvent,
  useEffect,
  useReducer,
  useRef,
  useState
} from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import sanitizeHtml from 'sanitize-html'

import {
  createNote,
  createPoll,
  updateNote,
  uploadAttachment
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
} from '@/lib/models/actor'
import { Attachment } from '@/lib/models/attachment'
import {
  EditableStatus,
  Status,
  StatusNote,
  StatusType
} from '@/lib/models/status'
import { getVisibility } from '@/lib/utils/getVisibility'
import { SANITIZED_OPTION } from '@/lib/utils/text/sanitizeText'
import { urlToId } from '@/lib/utils/urlToId'

import { Duration, PollChoices } from './poll-choices'
import {
  DEFAULT_STATE,
  addAttachment,
  addPollChoice,
  removePollChoice,
  resetExtension,
  setAttachments,
  setPollDurationInSeconds,
  setPollType,
  setPollVisibility,
  setVisibility,
  statusExtensionReducer,
  updateAttachment
} from './reducers'
import { ReplyPreview } from './reply-preview'
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

  const onPost = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()

    setAllowPost(false)
    setIsPosting(true)
    setWarningMsg(null)
    const message = text
    try {
      if (postExtension.poll.showing) {
        const poll = postExtension.poll
        await createPoll({
          message,
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
        const { content } = await updateNote({
          statusId: urlToId(editStatus.id),
          message
        })
        editStatus.text = content
        onPostUpdated(editStatus)
        dispatch(resetExtension())

        setText('')
        setIsPosting(false)
        return
      }

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

      // Filter out attachments that were removed during upload
      const currentAttachmentIds = new Set(
        postExtensionRef.current.attachments.map((a) => a.id)
      )
      const attachments = uploadResults
        .filter((a) =>
          // It is possible that the attachment is not in the current list
          // because it was removed during the upload process.
          // However, the current list might have the new ID or the old ID.
          // If the attachment is in the current list, it means it was not removed.
          // If checking with only original ID, it might be removed by the user
          // but the current list has the old ID.
          // If checking with only new ID, it might be removed by the user
          // but the current list has the new ID.
          // Wait, the postExtensionRef.current update is async in react
          // so it might still have the old ID or the new ID?
          // The dispatch is async, but the ref update is in useEffect which is also async
          // relative to this function execution?
          // Actually, dispatch triggers re-render, leading to useEffect update ref.
          // So inside this async function, the ref update might happen after await.
          // So we should check if the original ID is in the list (meaning not removed yet / old state)
          // OR if the new ID is in the list (meaning not removed / new state).
          {
            return (
              currentAttachmentIds.has(a.originalId) ||
              currentAttachmentIds.has(a.uploadedAttachment.id)
            )
          }
        )
        .map((a) => a.uploadedAttachment)

      const response = await createNote({
        message,
        replyStatus,
        attachments,
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
    if (
      editStatus &&
      value === sanitizeHtml(editStatus.text, { allowedTags: [] })
    ) {
      setAllowPost(false)
      return
    }
    setAllowPost(true)
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
    if (editStatus) {
      setText(editStatus.text)
      setAllowPost(false) // Initial state for edit is disabled until changed? Or should we check?
      // Original logic in onTextChange checked if text === editStatus.text.
      // So if we set text to editStatus.text, allowPost should be false.
      // But we need to update allowPost.
      return
    } else {
      setText('')
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
                    <div className="prose prose-sm max-w-none">
                      <ReactMarkdown
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
              variant="link"
              onClick={() =>
                dispatch(setPollVisibility(!postExtension.poll.showing))
              }
            >
              <BarChart3 className="size-4" />
            </Button>
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
        <div className="grid gap-4 grid-cols-8">
          {postExtension.attachments.map((item, index) => {
            return (
              <div
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
              </div>
            )
          })}
        </div>
      </form>
    </div>
  )
}
