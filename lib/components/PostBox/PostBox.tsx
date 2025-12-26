import {
  FC,
  FormEvent,
  KeyboardEvent,
  useEffect,
  useReducer,
  useRef,
  useState
} from 'react'
import { BarChart3 } from 'lucide-react'
import sanitizeHtml from 'sanitize-html'
import ReactMarkdown from 'react-markdown'

import { createNote, createPoll, updateNote } from '@/lib/client'
import { Button } from '@/lib/components/ui/button'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '@/lib/components/ui/tabs'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import {
  ActorProfile,
  getMention,
  getMentionFromActorID
} from '@/lib/models/actor'
import { Attachment, UploadedAttachment } from '@/lib/models/attachment'
import {
  EditableStatus,
  Status,
  StatusNote,
  StatusType
} from '@/lib/models/status'
import { urlToId } from '@/lib/utils/urlToId'

import { Duration, PollChoices } from './PollChoices'
import { ReplyPreview } from './ReplyPreview'
import { UploadMediaButton } from './UploadMediaButton'
import {
  DEFAULT_STATE,
  addPollChoice,
  removePollChoice,
  resetExtension,
  setAttachments,
  setPollDurationInSeconds,
  setPollVisibility,
  statusExtensionReducer
} from './reducers'

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
  const [currentTab, setCurrentTab] = useState<string>('write')
  const postBoxRef = useRef<HTMLTextAreaElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const [postExtension, dispatch] = useReducer(
    statusExtensionReducer,
    DEFAULT_STATE
  )

  const onPost = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    if (!postBoxRef.current) return

    setAllowPost(false)
    const message = postBoxRef.current.value
    try {
      if (postExtension.poll.showing) {
        const poll = postExtension.poll
        await createPoll({
          message,
          choices: poll.choices.map((item) => item.text),
          durationInSeconds: poll.durationInSeconds,
          replyStatus
        })

        dispatch(resetExtension())
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

        postBoxRef.current.value = ''
        return
      }

      const attachments = postExtension.attachments
      const response = await createNote({
        message,
        replyStatus,
        attachments
      })

      const { status, attachments: storedAttachments } = response
      onPostCreated(status, storedAttachments)
      dispatch(resetExtension())

      postBoxRef.current.value = ''
    } catch {
      alert('Fail to create a post')
    }
  }

  const onCloseReply = () => {
    onDiscardReply()

    if (!postBoxRef.current) return
    const postBox = postBoxRef.current
    postBox.value = ''
  }

  const onSelectUploadedMedias = (medias: UploadedAttachment[]) =>
    dispatch(setAttachments([...postExtension.attachments, ...medias]))

  const onRemoveAttachment = (attachmentIndex: number) => {
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

  const onTextChange = () => {
    if (!postBoxRef.current) {
      return setAllowPost(false)
    }

    const text = postBoxRef.current.value
    if (text.trim().length === 0) {
      setAllowPost(false)
      return
    }
    if (
      editStatus &&
      text === sanitizeHtml(editStatus.text, { allowedTags: [] })
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
    if (!postBoxRef.current) return
    const postBox = postBoxRef.current

    if (editStatus) {
      postBox.value = editStatus.text
      postBox.focus()
      return
    } else {
      postBox.value = ''
    }

    if (!replyStatus) return

    if (replyStatus.type !== StatusType.enum.Note) {
      postBox.focus()
      return
    }

    const defaultMessage = getDefaultMessage(profile, replyStatus)
    if (!defaultMessage) {
      postBox.focus()
      return
    }

    const [value, start, end] = defaultMessage
    postBox.value = value
    postBox.selectionStart = start
    postBox.selectionEnd = end
    postBox.focus()
  }, [profile, replyStatus, editStatus])

  return (
    <div>
      <ReplyPreview host={host} status={replyStatus} onClose={onCloseReply} />
      <form ref={formRef} onSubmit={onPost}>
        <div className="flex items-start gap-4 mb-3">
          <Avatar className="size-12">
            <AvatarImage src={profile.iconUrl} alt={profile.name ?? profile.username} />
            <AvatarFallback>
              {(profile.name ?? profile.username).charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1">
            <Tabs value={currentTab} onValueChange={setCurrentTab}>
              <TabsList className="grid w-full grid-cols-2 mb-3">
                <TabsTrigger value="write">Write</TabsTrigger>
                <TabsTrigger value="preview">Preview</TabsTrigger>
              </TabsList>

              <TabsContent value="write" className="mt-0">
                <textarea
                  ref={postBoxRef}
                  className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  rows={5}
                  onKeyDown={onQuickPost}
                  onChange={onTextChange}
                  name="message"
                  placeholder="What's on your mind?"
                />
              </TabsContent>

              <TabsContent value="preview" className="mt-0">
                <div className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  {postBoxRef.current?.value ? (
                    <div className="prose prose-sm max-w-none">
                      <ReactMarkdown>{postBoxRef.current.value}</ReactMarkdown>
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
          onAddChoice={() => dispatch(addPollChoice)}
          onRemoveChoice={(index) => dispatch(removePollChoice(index))}
          onChooseDuration={(durationInSeconds: Duration) =>
            dispatch(setPollDurationInSeconds(durationInSeconds))
          }
        />
        <div className="flex justify-between mb-3">
          <div>
            <UploadMediaButton
              isMediaUploadEnabled={isMediaUploadEnabled}
              onSelectMedias={onSelectUploadedMedias}
            />
            <Button
              variant="link"
              onClick={() =>
                dispatch(setPollVisibility(!postExtension.poll.showing))
              }
            >
              <BarChart3 className="size-4" />
            </Button>
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
            <Button disabled={!allowPost} type="submit">
              {editStatus ? 'Update' : 'Post'}
            </Button>
          </div>
        </div>
        <div className="grid gap-4 grid-cols-8">
          {postExtension.attachments.map((item, index) => {
            return (
              <div
                className="w-full aspect-square bg-border bg-center bg-cover cursor-pointer"
                key={item.id}
                style={{
                  backgroundImage: `url("${item.posterUrl || item.url}")`
                }}
                onClick={() => onRemoveAttachment(index)}
              />
            )
          })}
        </div>
      </form>
    </div>
  )
}
