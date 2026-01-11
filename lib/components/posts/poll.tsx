'use client'

import { formatDistance } from 'date-fns'
import { FC, useState } from 'react'

import { votePoll } from '@/lib/client'

import { Status, StatusType } from '../../models/status'

interface Props {
  status: Status
  currentTime: Date
  currentActorId?: string
}

export const Poll: FC<Props> = ({ status, currentTime, currentActorId }) => {
  const [selectedChoices, setSelectedChoices] = useState<number[]>([])
  const [isVoting, setIsVoting] = useState(false)
  const [votedChoices, setVotedChoices] = useState<number[]>(
    status.type === StatusType.enum.Poll && status.ownVotes
      ? status.ownVotes
      : []
  )

  if (status.type !== StatusType.enum.Poll) return null
  if (!status.choices) return null

  const isPollClosed = currentTime.getTime() > status.endAt
  const choices = status.choices
  const totalVotes =
    choices.reduce((sum, choice) => sum + choice.totalVotes, 0) || 1

  const isMultiple = status.pollType === 'anyOf'
  const hasVoted = votedChoices.length > 0

  const backgroundRevertPercentage = choices.map((choice) => {
    if (choice.totalVotes === 0) return 0
    return 1 - (choice.totalVotes / totalVotes) * 100
  })

  const handleVote = async () => {
    if (selectedChoices.length === 0) return

    setIsVoting(true)
    try {
      await votePoll({ statusId: status.id, choices: selectedChoices })
      setVotedChoices(selectedChoices)
      setSelectedChoices([])
    } catch (error) {
      console.error('Failed to vote:', error)
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

  return (
    <div>
      {choices.map((choice, index) => (
        <div key={`poll-${index}`} className="mb-2">
          {canVote ? (
            <div>
              <input
                className="mr-2 align-middle"
                type={isMultiple ? 'checkbox' : 'radio'}
                id={`choice-${index}`}
                checked={selectedChoices.includes(index)}
                onChange={() => handleChoiceChange(index)}
                name={`poll-${status.id}`}
              />
              <label className="cursor-pointer" htmlFor={`choice-${index}`}>
                {choice.title}
              </label>
            </div>
          ) : (
            <div
              className="flex"
              style={{
                background: `linear-gradient(90deg, pink ${
                  (choice.totalVotes / totalVotes) * 100
                }%, rgba(255,255,255, 0) ${backgroundRevertPercentage[index]}%)`
              }}
            >
              <label
                className="flex-1 cursor-pointer"
                htmlFor={`choice-${index}`}
              >
                {choice.title}
                {votedChoices.includes(index) && ' ✓'}
              </label>
              <span>
                {choice.totalVotes} (
                {`${Number((choice.totalVotes / totalVotes) * 100).toFixed(2)}%`}
                )
              </span>
            </div>
          )}
        </div>
      ))}

      {canVote && (
        <button
          onClick={handleVote}
          disabled={isVoting || selectedChoices.length === 0}
          className="mt-2 rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 disabled:bg-gray-300"
        >
          {isVoting ? 'Voting...' : 'Vote'}
        </button>
      )}

      {isPollClosed ? <div className="text-sm">Poll closed</div> : null}
      {!isPollClosed ? (
        <div className="text-sm">
          Poll close in {formatDistance(status.endAt, currentTime)}
        </div>
      ) : null}
    </div>
  )
}
