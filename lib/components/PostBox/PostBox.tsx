import { FC, FormEvent, useRef, useState } from 'react'

import { createStatus } from '../../client'
import { Media } from '../../medias/apple/media'
import { Profile } from '../../models/actor'
import {
  AppleGalleryAttachment,
  PostBoxAttachment
} from '../../models/attachment'
import { Status } from '../../models/status'
import { Button } from '../Button'
import { AppleGallerButton } from './AppleGalleryButton'
import styles from './PostBox.module.scss'
import { ReplyPreview } from './ReplyPreview'

interface Props {
  profile: Profile
  replyStatus?: Status
  onDiscardReply: () => void
  onPostCreated: (status: Status) => void
}

export const PostBox: FC<Props> = ({
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
    const status = await createStatus({ message, replyStatus, attachments })
    if (!status) {
      // Handle error
      return
    }

    onPostCreated(status)
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
    const url = media.derivatives[biggestDerivatives].url
    if (!url) return

    const attachment: AppleGalleryAttachment = {
      type: 'apple',
      guid: media.guid,
      mediaType: 'image/jpg',
      name: media.caption,
      url,
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