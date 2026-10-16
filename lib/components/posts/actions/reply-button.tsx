import { MessageCircle } from 'lucide-react'
import { FC } from 'react'

import { Status, StatusNote, StatusPoll } from '@/lib/types/domain/status'

interface Props {
  className?: string
  status: StatusNote | StatusPoll
  /**
   * Names the post when the row's buttons do not all act on one ("the latest
   * post" on a combined post), so the label says which one it replies to.
   */
  targetLabel?: string
  onReply?: (status: Status) => void
}

export const ReplyButton: FC<Props> = ({ status, targetLabel, onReply }) => {
  const replyCount =
    typeof status.totalReplies === 'number'
      ? status.totalReplies
      : status.replies.length
  const target = targetLabel ?? 'post'
  const replyLabel =
    replyCount > 0
      ? `Reply to ${target}, ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`
      : `Reply to ${target}`

  return (
    <button
      className="flex cursor-pointer items-center gap-1.5 rounded-full px-2 py-1 text-sm transition-colors hover:bg-muted hover:text-reply-icon"
      title={replyLabel}
      aria-label={replyLabel}
      onClick={() => onReply?.(status)}
    >
      <MessageCircle className="h-4 w-4" />
      {replyCount > 0 && <span>{replyCount}</span>}
    </button>
  )
}
