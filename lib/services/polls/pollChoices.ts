import { Question } from '@/lib/types/activitypub'

export interface PollChoice {
  title: string
  totalVotes: number
}

// Map an ActivityPub `Question` onto this instance's poll `choices` shape.
// `oneOf` (single-choice) is preferred over `anyOf` (multiple-choice); a
// Question that carries neither yields an empty list. Each option's vote count
// comes from its `replies.totalItems`, defaulting to 0 when the collection is
// absent. Shared verbatim by syncRemotePoll, createPollJob and updatePollJob so
// the three cannot drift.
export const getPollChoicesFromQuestion = (question: Question): PollChoice[] =>
  question.oneOf?.map((answer) => ({
    title: answer.name,
    totalVotes: answer.replies?.totalItems ?? 0
  })) ??
  question.anyOf?.map((answer) => ({
    title: answer.name,
    totalVotes: answer.replies?.totalItems ?? 0
  })) ??
  []
