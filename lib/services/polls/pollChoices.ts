import { Question } from '@/lib/types/activitypub'

export interface PollChoice {
  title: string
  totalVotes: number
}

// Map an ActivityPub `Question` onto this instance's poll `choices` shape.
// `oneOf` (single-choice) is preferred over `anyOf` (multiple-choice); a
// Question that carries neither yields an empty list. Each option's vote count
// comes from its `replies.totalItems`; when that collection is absent (Mastodon
// omits it for `hide_totals` polls until they close, some servers never send
// it) the option keeps the tally of the stored choice with the same title, and
// 0 when there is none. Shared by syncRemotePoll, createPollJob and
// updatePollJob so the three cannot drift.
export const getPollChoicesFromQuestion = (
  question: Question,
  storedChoices: PollChoice[] = []
): PollChoice[] =>
  (question.oneOf ?? question.anyOf ?? []).map((answer) => ({
    title: answer.name,
    totalVotes:
      answer.replies?.totalItems ??
      storedChoices.find((choice) => choice.title === answer.name)
        ?.totalVotes ??
      0
  }))

const UNBOUNDED_POLL_MS = 100 * 365 * 24 * 60 * 60 * 1000

// The poll columns of a stored remote `Question`: its choices, whether it is
// single- or multiple-choice, and when it ends. A Question with no `endTime`
// is kept open for a century from `publishedAt`. Shared by createPollJob and
// fetchRemoteStatusJob so a poll stored either way has the same shape.
export const getPollFieldsFromQuestion = (
  question: Question,
  publishedAt: number
): { choices: PollChoice[]; pollType: 'oneOf' | 'anyOf'; endAt: number } => ({
  choices: getPollChoicesFromQuestion(question),
  pollType: question.oneOf ? 'oneOf' : question.anyOf ? 'anyOf' : 'oneOf',
  endAt: question.endTime
    ? new Date(question.endTime).getTime()
    : publishedAt + UNBOUNDED_POLL_MS
})
