import { Question } from '@/lib/types/activitypub'

export interface PollChoice {
  title: string
  totalVotes: number
}

// A Question's datetime string as a timestamp; undefined when it is missing or
// unparseable, so a bad value reads as "not given" rather than NaN (which
// updatePoll would store as null and hydration would then read as expired).
export const parseQuestionTime = (value: unknown): number | undefined => {
  if (typeof value !== 'string') return undefined
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : undefined
}

// Map an ActivityPub `Question` onto this instance's poll `choices` shape.
// `oneOf` (single-choice) is preferred over `anyOf` (multiple-choice); a
// Question that carries neither yields an empty list. Each option's vote count
// comes from its `replies.totalItems`; when that collection is absent (Mastodon
// omits it for `hide_totals` polls until they close, some servers never send
// it) the option keeps the tally of the stored choice at the same POSITION —
// by index, not title, so duplicate titles each keep their own count; callers
// pass stored choices only when the option list is the stored one in order —
// and 0 when there is none. Shared by syncRemotePoll, createPollJob and
// updatePollJob so the three cannot drift.
export const getPollChoicesFromQuestion = (
  question: Question,
  storedChoices: PollChoice[] = []
): PollChoice[] =>
  (question.oneOf ?? question.anyOf ?? []).map((answer, index) => ({
    title: answer.name,
    totalVotes:
      answer.replies?.totalItems ?? storedChoices[index]?.totalVotes ?? 0
  }))

// When a Question ends, as Mastodon's PollParser#expires_at reads it: a
// parseable string `closed` wins over `endTime`, any other truthy `closed`
// means the poll closed now, otherwise `endTime`. Undefined when the Question
// gives no (parseable) deadline, so callers keep the stored one. A poll a
// bare `closed` already closed (its stored `endAt` has passed) keeps that
// `endAt`: re-closing at a new "now" on every delivery or fetch would move
// the deadline and record a revision each time.
export const getPollEndAtFromQuestion = (
  question: Question,
  storedEndAt?: number
): number | undefined => {
  if (typeof question.closed === 'string') {
    return (
      parseQuestionTime(question.closed) ?? parseQuestionTime(question.endTime)
    )
  }
  if (question.closed) {
    const now = Date.now()
    return storedEndAt !== undefined && storedEndAt <= now ? storedEndAt : now
  }
  return parseQuestionTime(question.endTime)
}

const UNBOUNDED_POLL_MS = 100 * 365 * 24 * 60 * 60 * 1000

// The poll columns of a stored remote `Question`: its choices, whether it is
// single- or multiple-choice, when it ends and the origin's `updated` it was
// first seen with (so an older Update delivered later is ignored from the
// start). A Question with no (parseable) deadline is kept open for a century
// from `publishedAt`. Shared by createPollJob and fetchRemoteStatusJob so a
// poll stored either way has the same shape.
export const getPollFieldsFromQuestion = (
  question: Question,
  publishedAt: number
): {
  choices: PollChoice[]
  pollType: 'oneOf' | 'anyOf'
  endAt: number
  remoteUpdatedAt: number | undefined
} => ({
  choices: getPollChoicesFromQuestion(question),
  pollType: question.oneOf ? 'oneOf' : question.anyOf ? 'anyOf' : 'oneOf',
  endAt: getPollEndAtFromQuestion(question) ?? publishedAt + UNBOUNDED_POLL_MS,
  remoteUpdatedAt: parseQuestionTime(question.updated)
})
