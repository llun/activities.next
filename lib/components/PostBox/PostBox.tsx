import { FC, FormEvent, useRef, useState } from 'react'

import { createStatus } from '../../client'
import { Media } from '../../medias/apple/media'
import { Profile } from '../../models/actor'
import { Status } from '../../models/status'
import { Button } from '../Button'
import { AppleGallerButton } from './AppleGalleryButton'
import styles from './PostBox.module.scss'
import { ReplyPreview } from './ReplyPreview'

interface AppleGalleryAttachment {
  type: 'apple'
  guid: string
  mediaType: string
  url: string
  width: number
  height: number
  name?: string
}

type PostAttachment = AppleGalleryAttachment

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
  const [attachments, setAttachments] = useState<PostAttachment[]>([])
  const postBoxRef = useRef<HTMLTextAreaElement>(null)

  const onPost = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!postBoxRef.current) return

    const message = postBoxRef.current.value
    const status = await createStatus({ message, replyStatus })
    if (!status) {
      // Handle error
      return
    }

    onPostCreated(status)
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
    console.log(media)

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
    console.log(attachments)
    setAttachments([...attachments, attachment])
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
          {attachments.map((item) => (
            <div
              className={styles.attachment}
              key={item.guid}
              style={{ backgroundImage: `url(${item.url})` }}
            />
          ))}
        </div>
      </form>
    </div>
  )
}
