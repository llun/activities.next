'use client'

import { formatDistance } from 'date-fns'
import { Check } from 'lucide-react'
import { FC, useEffect, useState } from 'react'

import { votePoll } from '@/lib/client'
import { Status, StatusType } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'

import { useTranslationContext } from './translation-context'

interface Props {
  status: Status
  currentTime: number
  currentActorId?: string
}

export const Poll: FC<Props> = ({ status, currentTime, currentActorId }) => {
  // When the surrounding status is translated, flip the option titles together
  // with the body. Mastodon's translate response returns `poll.options[]` in
  // the same order as the original choices.
  const translation = useTranslationContext()
  const pollEndAt =
    status.type === StatusType.enum.Poll ? status.endAt : undefined
  const [now, setNow] = useState(currentTime)
  const [selectedChoices, setSelectedChoices] = useState<number[]>([])
  const [isVoting, setIsVoting] = useState(false)
  const [votedChoices, setVotedChoices] = useState<number[]>(
    status.type === StatusType.enum.Poll && status.ownVotes
      ? status.ownVotes
      : []
  )
  const [voteError, setVoteError] = useState<string | null>(null)

  useEffect(() => {
    setNow(currentTime)
  }, [currentTime])

  useEffect(() => {
    if (pollEndAt === undefined) return

    const nextNow = Date.now()
    setNow(nextNow)
    if (nextNow >= pollEndAt) return

    const timeout = setTimeout(() => {
      setNow(Date.now())
    }, pollEndAt - nextNow)

    return () => {
      clearTimeout(timeout)
    }
  }, [pollEndAt, status.id])

  if (status.type !== StatusType.enum.Poll) return null
  if (!status.choices) return null

  const isPollClosed = now >= status.endAt
  const choices = status.choices
  const translatedOptions =
    translation?.showingTranslation && translation.translation?.poll
      ? translation.translation.poll.options
      : null
  const titleFor = (index: number) =>
    translatedOptions?.[index]?.title ?? choices[index].title
  const voteCount = choices.reduce((sum, choice) => sum + choice.totalVotes, 0)
  const totalVotes = voteCount || 1

  const isMultiple = status.pollType === 'anyOf'
  const hasVoted = votedChoices.length > 0

  const handleVote = async () => {
    if (selectedChoices.length === 0) return

    setIsVoting(true)
    setVoteError(null)
    try {
      await votePoll({ statusId: status.id, choices: selectedChoices })
      setVotedChoices(selectedChoices)
      setSelectedChoices([])
    } catch {
      setVoteError('Failed to submit vote. Please try again.')
    } finally {
      setIsVoting(false)
    }
  }

  const handleChoiceChange = (index: number) => {
    if (isMultiple) {
      setSelectedChoices((prev) =>
        prev.includes(index)
          ? prev.filter((i) => i !== index)
          : [...prev, index]
      )
    } else {
      setSelectedChoices([index])
    }
  }

  const canVote = currentActorId && !hasVoted && !isPollClosed

  const meta = (
    <div className="text-xs text-muted-foreground">
      {`${voteCount.toLocaleString()} ${voteCount === 1 ? 'vote' : 'votes'}`}
      {isMultiple ? ' · Choose multiple' : ''}
      {' · '}
      <span>
        {isPollClosed
          ? 'Poll closed'
          : `Poll closes in ${formatDistance(status.endAt, now)}`}
      </span>
    </div>
  )

  return (
    <div className="mt-2.5">
      <div className="flex flex-col gap-1.5">
        {choices.map((choice, index) => {
          if (canVote) {
            const checked = selectedChoices.includes(index)
            return (
              <label
                key={`poll-${status.id}-${index}`}
                htmlFor={`choice-${status.id}-${index}`}
                className={cn(
                  'flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors',
                  'has-[:focus-visible]:border-ring has-[:focus-visible]:ring-ring/50 has-[:focus-visible]:ring-[3px]',
                  checked
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-background hover:bg-muted'
                )}
              >
                <input
                  className="sr-only"
                  type={isMultiple ? 'checkbox' : 'radio'}
                  id={`choice-${status.id}-${index}`}
                  checked={checked}
                  onChange={() => handleChoiceChange(index)}
                  name={`poll-${status.id}`}
                />
                <span
                  aria-hidden
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center border-2 transition-colors',
                    isMultiple ? 'rounded-[4px]' : 'rounded-full',
                    checked
                      ? 'border-primary bg-primary'
                      : 'border-muted-foreground/60 bg-transparent'
                  )}
                >
                  {checked &&
                    (isMultiple ? (
                      <Check className="size-3 text-primary-foreground" />
                    ) : (
                      <span className="size-1.5 rounded-full bg-primary-foreground" />
                    ))}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {titleFor(index)}
                </span>
              </label>
            )
          }

          const mine = votedChoices.includes(index)
          const percentage = Math.round((choice.totalVotes / totalVotes) * 100)
          return (
            <div
              key={`poll-${status.id}-${index}`}
              className={cn(
                'relative overflow-hidden rounded-lg border px-3 py-2.5 text-sm',
                mine ? 'border-primary' : 'border-border'
              )}
            >
              <div
                className={cn(
                  'absolute inset-y-0 left-0 transition-[width] duration-500',
                  mine ? 'bg-primary/15' : 'bg-muted'
                )}
                style={{ width: `${percentage}%` }}
              />
              <div className="relative flex items-center gap-2">
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate',
                    mine && 'font-semibold'
                  )}
                >
                  {titleFor(index)}
                  {mine && <span className="text-primary"> ✓</span>}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {percentage}%
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {canVote ? (
        <div className="mt-2.5 flex items-center gap-3">
          <button
            onClick={handleVote}
            disabled={isVoting || selectedChoices.length === 0}
            className="h-8 shrink-0 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isVoting ? 'Voting...' : 'Vote'}
          </button>
          {meta}
        </div>
      ) : (
        <div className="mt-2">{meta}</div>
      )}

      {voteError ? (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {voteError}
        </p>
      ) : null}
    </div>
  )
}
