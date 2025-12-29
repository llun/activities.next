'use client'

import { formatDistance } from 'date-fns'
import { FC, useState } from 'react'

import { votePoll } from '@/lib/client'
import { Status, StatusType } from '@/lib/models/status'
import { urlToId } from '@/lib/utils/urlToId'

interface Props {
  status: Status
  currentTime: Date
  voted?: boolean
  ownVotes?: number[]
  onVoteSuccess?: () => void
}

export const Poll: FC<Props> = ({
  status,
  currentTime,
  voted = false,
  ownVotes = [],
  onVoteSuccess
}) => {
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null)
  const [isVoting, setIsVoting] = useState(false)
  const [hasVoted, setHasVoted] = useState(voted)
  const [userVotes, setUserVotes] = useState<number[]>(ownVotes)
  const [localChoices, setLocalChoices] = useState(
    status.type === StatusType.enum.Poll ? status.choices : []
  )
  const [error, setError] = useState<string | null>(null)

  if (status.type !== StatusType.enum.Poll) return null
  if (!status.choices) return null

  const isPollClosed = currentTime.getTime() > status.endAt
  const canVote = !isPollClosed && !hasVoted && !isVoting
  const choices = localChoices
  const totalVotes =
    choices.reduce((sum, choice) => sum + choice.totalVotes, 0) || 1

  const backgroundRevertPercentage = choices.map((choice) => {
    if (choice.totalVotes === 0) return 0
    return 1 - (choice.totalVotes / totalVotes) * 100
  })

  const handleVote = async () => {
    if (selectedChoice === null) return
    if (!canVote) return

    setIsVoting(true)
    setError(null)

    try {
      // Optimistic update
      const optimisticChoices = choices.map((choice, index) =>
        index === selectedChoice
          ? { ...choice, totalVotes: choice.totalVotes + 1 }
          : choice
      )
      setLocalChoices(optimisticChoices)
      setHasVoted(true)
      setUserVotes([selectedChoice])

      // Submit vote
      const pollId = urlToId(status.id)
      await votePoll({
        pollId,
        choices: [selectedChoice]
      })

      // Trigger refresh if callback provided
      if (onVoteSuccess) {
        onVoteSuccess()
      }
    } catch (err) {
      // Revert optimistic update on error
      setLocalChoices(status.choices)
      setHasVoted(voted)
      setUserVotes(ownVotes)
      setError(
        err instanceof Error ? err.message : 'Failed to submit vote. Please try again.'
      )
    } finally {
      setIsVoting(false)
    }
  }

  const handleChoiceChange = (index: number) => {
    if (canVote) {
      setSelectedChoice(index)
    }
  }

  return (
    <div className="poll-container">
      {choices.map((choice, index) => {
        const isUserChoice = userVotes.includes(index)
        const isSelected = selectedChoice === index

        return (
          <div key={`poll-${index}`} className="mb-2">
            <div className="flex items-center">
              <input
                className="mr-2 align-middle"
                type="radio"
                id={`choice-${index}`}
                name={`poll-${status.id}`}
                disabled={!canVote}
                checked={hasVoted ? isUserChoice : isSelected}
                onChange={() => handleChoiceChange(index)}
                value={index}
                aria-label={`Vote for ${choice.title}`}
              />

              <div
                className="flex flex-1"
                style={{
                  background: `linear-gradient(90deg, pink ${
                    (choice.totalVotes / totalVotes) * 100
                  }%, rgba(255,255,255, 0) ${backgroundRevertPercentage[index]}%)`
                }}
              >
                <label
                  className={`flex-1 ${canVote ? 'cursor-pointer' : 'cursor-default'}`}
                  htmlFor={`choice-${index}`}
                >
                  {choice.title}
                  {isUserChoice && hasVoted && (
                    <span className="ml-2" aria-label="Your vote">
                      ✓
                    </span>
                  )}
                </label>
                <span className="ml-2">
                  {choice.totalVotes} (
                  {`${Number((choice.totalVotes / totalVotes) * 100).toFixed(2)}%`})
                </span>
              </div>
            </div>
          </div>
        )
      })}

      {!hasVoted && !isPollClosed && selectedChoice !== null && (
        <button
          onClick={handleVote}
          disabled={isVoting}
          className="mt-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
          aria-label="Submit vote"
        >
          {isVoting ? 'Voting...' : 'Vote'}
        </button>
      )}

      {error && (
        <div className="mt-2 text-red-500 text-sm" role="alert">
          {error}
        </div>
      )}

      {hasVoted && !error && (
        <div className="mt-2 text-sm text-gray-600">You voted on this poll</div>
      )}

      {isPollClosed ? (
        <div className="text-sm mt-2">Poll closed</div>
      ) : (
        <div className="text-sm mt-2">
          Poll closes in {formatDistance(status.endAt, currentTime)}
        </div>
      )}

      <div className="text-sm text-gray-500 mt-1">
        {totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}
      </div>
    </div>
  )
}
