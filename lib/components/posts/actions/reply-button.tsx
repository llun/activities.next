import { MessageCircle } from 'lucide-react'
import { FC } from 'react'

import { Status, StatusNote, StatusPoll } from '@/lib/types/domain/status'

interface Props {
  className?: string
  status: StatusNote | StatusPoll
  onReply?: (status: Status) => void
}

export const ReplyButton: FC<Props> = ({ status, onReply }) => {
  const replyLabel =
    status.replies.length > 0
      ? `Reply to post, ${status.replies.length} ${
          status.replies.length === 1 ? 'reply' : 'replies'
        }`
      : 'Reply to post'

  return (
    <button
      className="flex cursor-pointer items-center gap-1.5 rounded-full px-2 py-1 text-sm transition-colors hover:bg-muted hover:text-blue-500"
      title={replyLabel}
      aria-label={replyLabel}
      onClick={() => onReply?.(status)}
    >
      <MessageCircle className="h-4 w-4" />
      {status.replies.length > 0 && <span>{status.replies.length}</span>}
    </button>
  )
}
