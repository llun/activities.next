import { FC, FormEvent, useRef } from 'react'

import { Status } from '../models/status'
import { Button } from './Button'
import { ReplyPreview } from './ReplyPreview'

interface Props {
  replyStatus?: Status
  onDiscardReply: () => void
  onCreatePostSuccess: (status: Status) => void
}

export const PostBox: FC<Props> = ({
  replyStatus,
  onCreatePostSuccess,
  onDiscardReply
}) => {
  const postBoxRef = useRef<HTMLTextAreaElement>(null)

  const onPost = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!postBoxRef.current) return

    const message = postBoxRef.current.value
    const response = await fetch('/api/v1/accounts/outbox', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        replyStatus,
        message
      })
    })
    if (response.status !== 200) {
      // Handle error here
      return
    }

    const json = await response.json()

    onCreatePostSuccess(json.status)
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
        <Button type="submit">Send</Button>
      </form>
    </div>
  )
}
