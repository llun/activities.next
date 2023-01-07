import { FC, FormEvent, useEffect, useRef, useState } from 'react'

import { createStatus } from '../../client'
import { Media } from '../../medias/apple/media'
import { Actor, Profile } from '../../models/actor'
import {
  AppleGalleryAttachment,
  Attachment,
  PostBoxAttachment
} from '../../models/attachment'
import { StatusData } from '../../models/status'
import { Button } from '../Button'
import { AppleGallerButton } from './AppleGalleryButton'
import styles from './PostBox.module.scss'
import { ReplyPreview } from './ReplyPreview'

interface Props {
  host: string
  profile: Profile
  replyStatus?: StatusData
  onDiscardReply: () => void
  onPostCreated: (status: StatusData, attachments: Attachment[]) => void
}

export const PostBox: FC<Props> = ({
  host,
  profile,
  replyStatus,
  onPostCreated,
  onDiscardReply
}) => {
  const [attachments, setAttachments] = useState<PostBoxAttachment[]>([])
  const postBoxRef = useRef<HTMLTextAreaElement>(null)

  const onPost = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!postBoxRef.current) return

    const message = postBoxRef.current.value
    const response = await createStatus({
      message,
      replyStatus,
      attachments
    })
    if (!response) {
      // Handle error
      return
    }

    const { status, attachments: storedAttachments } = response
    onPostCreated(status, storedAttachments)
    setAttachments([])
    postBoxRef.current.value = ''
  }

  const onCloseReply = () => {
    onDiscardReply()

    if (!postBoxRef.current) return
    const postBox = postBoxRef.current
    postBox.value = ''
  }

  const onSelectAppleMedia = (media: Media) => {
    // Video is not supported yet
    if (media.type === 'video') return

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
   * @returns default message that user will use to send out the status
   */
  const getDefaultMessage = (profile: Profile, replyStatus?: StatusData) => {
    if (!replyStatus) return ''
    if (replyStatus.actorId === profile.id) return ''
    if (replyStatus.actor) {
      return `${Actor.getMentionFromProfile(replyStatus.actor)} `
    }
    return `${Actor.getMentionFromId(replyStatus.actorId)} `
  }

  useEffect(() => {
    if (!replyStatus) return
    if (!postBoxRef.current) return

    const postBox = postBoxRef.current
    postBox.selectionStart = postBox.value.length
    postBox.selectionEnd = postBox.value.length
    postBox.focus()
  }, [replyStatus])

  return (
    <div>
      <ReplyPreview status={replyStatus} onClose={onCloseReply} />
      <form onSubmit={onPost}>
        <div className="mb-3">
          <textarea
            ref={postBoxRef}
            className="form-control"
            rows={3}
            name="message"
            defaultValue={getDefaultMessage(profile, replyStatus)}
          />
        </div>
        <div className="d-flex justify-content-between mb-3">
          <div>
            <AppleGallerButton
              profile={profile}
              onSelectMedia={onSelectAppleMedia}
            />
          </div>
          <Button type="submit">Send</Button>
        </div>
        <div className={styles.attachments}>
          {attachments.map((item, index) => (
            <div
              className={styles.attachment}
              key={item.guid}
              style={{ backgroundImage: `url(${item.url})` }}
              onClick={() => onRemoveAttachment(index)}
            />
          ))}
        </div>
      </form>
    </div>
  )
}
