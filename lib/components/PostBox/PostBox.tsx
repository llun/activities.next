import {
  FC,
  FormEvent,
  KeyboardEvent,
  useEffect,
  useRef,
  useState
} from 'react'

import { createNote, createPoll } from '../../client'
import { Media } from '../../medias/apple/media'
import { Video720p, VideoPosterDerivative } from '../../medias/apple/webstream'
import { Actor, ActorProfile } from '../../models/actor'
import {
  AppleGalleryAttachment,
  Attachment,
  PostBoxAttachment
} from '../../models/attachment'
import { StatusData, StatusNote, StatusType } from '../../models/status'
import { Button } from '../Button'
import { AppleGallerButton } from './AppleGalleryButton'
import { Choice, PollChoices } from './PollChoices'
import styles from './PostBox.module.scss'
import { ReplyPreview } from './ReplyPreview'

interface Props {
  host: string
  profile: ActorProfile
  replyStatus?: StatusData
  onDiscardReply: () => void
  onPostCreated: (status: StatusData, attachments: Attachment[]) => void
}

const key = () => Math.round(Math.random() * 1000)

const DEFAULT_CHOICES = [
  { key: key(), text: '' },
  { key: key(), text: '' }
]

export const PostBox: FC<Props> = ({
  host,
  profile,
  replyStatus,
  onPostCreated,
  onDiscardReply
}) => {
  const [allowPost, setAllowPost] = useState<boolean>(false)
  const [attachments, setAttachments] = useState<PostBoxAttachment[]>([])
  const [showPolls, setShowPolls] = useState<boolean>(false)
  const postBoxRef = useRef<HTMLTextAreaElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [choices, setChoices] = useState<Choice[]>(DEFAULT_CHOICES)

  const onPost = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    if (!postBoxRef.current) return

    setAllowPost(false)
    const message = postBoxRef.current.value
    try {
      if (showPolls) {
        const response = await createPoll({
          message,
          choices: choices.map((item) => item.text),
          replyStatus
        })

        setAttachments([])
        setChoices(DEFAULT_CHOICES)
        setShowPolls(false)
        return
      }

      const response = await createNote({
        message,
        replyStatus,
        attachments
      })

      const { status, attachments: storedAttachments } = response
      onPostCreated(status, storedAttachments)
      setAttachments([])
      setChoices(DEFAULT_CHOICES)
      setShowPolls(false)

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

  const onSelectAppleMedia = (media: Media) => {
    if (media.type === 'video') {
      const poster = media.derivatives[VideoPosterDerivative]
      const video = media.derivatives[Video720p]
      const attachment: AppleGalleryAttachment = {
        type: 'apple',
        guid: media.guid,
        mediaType: 'video/mp4',
        name: media.caption,
        url: `https://${host}/api/v1/medias/apple/${profile.appleSharedAlbumToken}/${media.guid}@${video.checksum}`,
        posterUrl: `https://${host}/api/v1/medias/apple/${profile.appleSharedAlbumToken}/${media.guid}@${poster.checksum}`,
        width: media.width,
        height: media.height
      }
      setAttachments([...attachments, attachment])
      return
    }

    const biggestDerivatives = Object.keys(media.derivatives)
      .map((value) => parseInt(value, 10))
      .sort((n1, n2) => n2 - n1)[0]
    const bestDerivatives = media.derivatives[biggestDerivatives]
    const attachment: AppleGalleryAttachment = {
      type: 'apple',
      guid: media.guid,
      mediaType: 'image/jpeg',
      name: media.caption,
      url: `https://${host}/api/v1/medias/apple/${profile.appleSharedAlbumToken}/${media.guid}@${bestDerivatives.checksum}`,
      width: media.width,
      height: media.height
    }
    setAttachments([...attachments, attachment])
  }

  const onRemoveAttachment = (attachmentIndex: number) => {
    setAttachments([
      ...attachments.slice(0, attachmentIndex),
      ...attachments.slice(attachmentIndex + 1)
    ])
  }

  const onQuickPost = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.metaKey || event.ctrlKey)) return
    if (event.code !== 'Enter') return
    if (!allowPost) return
    if (!formRef.current) return
    onPost()
  }

  const onTextChange = () => {
    if (!postBoxRef.current) {
      return setAllowPost(false)
    }

    const text = postBoxRef.current.value
    setAllowPost(text.length > 0)
  }

  const onAddChoice = () => {
    if (choices.length > 4) return
    setChoices((previous) => [...previous, { key: key(), text: '' }])
  }

  const onRemoveChoice = (index: number) => {
    if (choices.length < 3) return
    setChoices([...choices.slice(0, index), ...choices.slice(index + 1)])
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
      ? `${Actor.getMentionFromProfile(replyStatus.actor, true)} `
      : `${Actor.getMentionFromId(replyStatus.actorId, true)} `
    const others = replyStatus.tags
      .filter((item) => item.type === 'mention')
      .filter(
        (item) => item.name !== Actor.getMentionFromProfile(profile, true)
      )
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
    if (!postBoxRef.current) return

    const postBox = postBoxRef.current
    if (replyStatus.type !== StatusType.Note) {
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
  }, [profile, replyStatus])

  return (
    <div>
      <ReplyPreview status={replyStatus} onClose={onCloseReply} />
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
          show={showPolls}
          choices={choices}
          onAddChoice={onAddChoice}
          onRemoveChoice={onRemoveChoice}
        />
        <div className="d-flex justify-content-between mb-3">
          <div>
            <AppleGallerButton
              profile={profile}
              onSelectMedia={onSelectAppleMedia}
            />
            <Button
              variant="link"
              onClick={() => setShowPolls((value) => !value)}
            >
              <i className="bi bi-bar-chart-fill" />
            </Button>
          </div>
          <Button disabled={!allowPost} type="submit">
            Send
          </Button>
        </div>
        <div className={styles.attachments}>
          {attachments.map((item, index) => (
            <div
              className={styles.attachment}
              key={item.guid}
              style={{ backgroundImage: `url(${item.posterUrl || item.url})` }}
              onClick={() => onRemoveAttachment(index)}
            />
          ))}
        </div>
      </form>
    </div>
  )
}
