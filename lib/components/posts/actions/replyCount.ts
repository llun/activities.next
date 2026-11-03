import { StatusNote, StatusPoll } from '@/lib/types/domain/status'

/**
 * A post's reply count as its reply button shows it: the stored total, else
 * the replies it carries.
 */
export const getReplyCount = (status: StatusNote | StatusPoll): number =>
  typeof status.totalReplies === 'number'
    ? status.totalReplies
    : status.replies.length
