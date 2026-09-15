import { MessageCircle } from 'lucide-react'
import { FC } from 'react'

import { Status, StatusNote, StatusPoll } from '@/lib/types/domain/status'

interface Props {
  className?: string
  status: StatusNote | StatusPoll
  onReply?: (status: Status) => void
}

export const ReplyButton: FC<Props> = ({ status, onReply }) => {
  const replyCount =
    typeof status.totalReplies === 'number'
      ? status.totalReplies
      : status.replies.length
  const replyLabel =
    replyCount > 0
      ? `Reply to post, ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`
      : 'Reply to post'

  return (
    <button
      className="flex cursor-pointer items-center gap-1.5 rounded-full px-2 py-1 text-sm transition-colors hover:bg-muted hover:text-blue-500"
      title={replyLabel}
      aria-label={replyLabel}
      onClick={() => onReply?.(status)}
    >
      <MessageCircle className="h-4 w-4" />
      {replyCount > 0 && <span>{replyCount}</span>}
    </button>
  )
}
