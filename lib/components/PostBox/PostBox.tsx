import { FC, FormEvent, useRef } from 'react'

import { createStatus } from '../../client'
import { Media } from '../../medias/apple/media'
import { Profile } from '../../models/actor'
import { Status } from '../../models/status'
import { Button } from '../Button'
import { AppleGallerButton } from './AppleGalleryButton'
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
              onSelectMedia={(media: Media) => {
                console.log(media)
              }}
            />
          </div>
          <Button type="submit">Send</Button>
        </div>
      </form>
    </div>
  )
}
