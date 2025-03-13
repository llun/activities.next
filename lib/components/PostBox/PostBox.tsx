import {
  FC,
  FormEvent,
  KeyboardEvent,
  useEffect,
  useReducer,
  useRef,
  useState
} from 'react'
import sanitizeHtml from 'sanitize-html'

import { createNote, createPoll, updateNote } from '@/lib/client'
import { Button } from '@/lib/components/Button'
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
import styles from './PostBox.module.scss'
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
        <div className="mb-3">
          <textarea
            ref={postBoxRef}
            className="form-control"
            rows={5}
            onKeyDown={onQuickPost}
            onChange={onTextChange}
            name="message"
          />
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
        <div className="d-flex justify-content-between mb-3">
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
              <i className="bi bi-bar-chart-fill" />
            </Button>
          </div>
          <div>
            {editStatus ? (
              <Button
                className="me-2"
                type="button"
                variant="danger"
                onClick={onDiscardEdit}
              >
                Cancel Edit
              </Button>
            ) : null}
            <Button disabled={!allowPost} type="submit">
              {editStatus ? 'Update' : 'Send'}
            </Button>
          </div>
        </div>
        <div className={styles.attachments}>
          {postExtension.attachments.map((item, index) => {
            return (
              <div
                className={styles.attachment}
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
