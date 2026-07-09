import { persistEmojiTagsForStatus } from '@/lib/actions/createNote'
import { Database } from '@/lib/database/types'
import { persistDetectedLanguage } from '@/lib/services/language-detection'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { Actor } from '@/lib/types/domain/actor'
import { StatusPoll, StatusType } from '@/lib/types/domain/status'
import { getSpan } from '@/lib/utils/trace'

interface UpdatePollFromUserInput {
  statusId: string
  currentActor: Actor
  text?: string
  summary?: string | null
  sensitive?: boolean
  language?: string | null
  poll?: {
    options: string[]
    expiresIn?: number
    multiple?: boolean
    hideTotals?: boolean
  }
  status?: StatusPoll
  database: Database
}

export const updatePollFromUserInput = async ({
  statusId,
  currentActor,
  text,
  summary,
  sensitive,
  language,
  poll,
  status: preloadedStatus,
  database
}: UpdatePollFromUserInput) => {
  const span = getSpan('actions', 'updatePollFromUser', { statusId })
  const status = preloadedStatus ?? (await database.getStatus({ statusId }))
  if (
    !status ||
    status.id !== statusId ||
    status.type !== StatusType.enum.Poll ||
    status.actorId !== currentActor.id
  ) {
    span.end()
    return null
  }

  const existingTitles = status.choices.map((choice) => choice.title)
  const nextPollType =
    poll?.multiple === undefined
      ? status.pollType
      : poll.multiple
        ? 'anyOf'
        : 'oneOf'
  // Mastodon resets votes only when the option set or the multiple-choice mode
  // actually changes (UpdateStatusService#update_poll!); expiry and
  // hide_totals adjust in place without invalidating existing votes.
  const resetVotes =
    poll !== undefined &&
    (poll.options.length !== existingTitles.length ||
      poll.options.some((option, index) => option !== existingTitles[index]) ||
      nextPollType !== status.pollType)

  let updatedStatus = await database.updatePoll({
    statusId,
    text: text ?? status.text,
    summary: summary === undefined ? undefined : summary?.trim() || '',
    choices: resetVotes
      ? poll!.options.map((title) => ({ title, totalVotes: 0 }))
      : status.choices.map((choice) => ({
          title: choice.title,
          totalVotes: choice.totalVotes
        })),
    ...(sensitive !== undefined ? { sensitive } : {}),
    ...(language !== undefined ? { language } : {}),
    ...(poll?.expiresIn !== undefined
      ? { endAt: Date.now() + poll.expiresIn * 1000 }
      : {}),
    ...(poll?.multiple !== undefined ? { pollType: nextPollType } : {}),
    ...(poll?.hideTotals !== undefined ? { hideTotals: poll.hideTotals } : {}),
    resetVotes
  })
  if (!updatedStatus) {
    span.end()
    return null
  }

  // Mirror updateNoteFromUserInput: re-sync emoji tags and re-detect the
  // content language when the text changes.
  if (text !== undefined) {
    await database.deleteStatusTagsByType({ statusId, type: 'emoji' })
    await persistEmojiTagsForStatus({ database, statusId, text })
    await persistDetectedLanguage({ database, statusId, text })
    updatedStatus = (await database.getStatus({ statusId })) ?? updatedStatus
  }

  await addStatusToTimelines(database, updatedStatus)

  // Outbound federation of poll edits (Update(Question)) is not wired up:
  // getNoteFromStatus returns null for polls and sendUpdateNoteJob rejects
  // non-Note statuses, so the edit stays local for now.

  span.end()
  return updatedStatus
}
