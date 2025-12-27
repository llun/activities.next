import { formatDistance } from 'date-fns'
import { FC } from 'react'

import { Status, StatusType } from '../../models/status'

interface Props {
  status: Status
  currentTime: Date
}

export const Poll: FC<Props> = ({ status, currentTime }) => {
  if (status.type !== StatusType.enum.Poll) return null
  if (!status.choices) return null

  const isPollClosed = currentTime.getTime() > status.endAt
  const choices = status.choices
  const totalVotes =
    choices.reduce((sum, choice) => sum + choice.totalVotes, 0) || 1

  const backgroundRevertPercentage = choices.map((choice) => {
    if (choice.totalVotes === 0) return 0
    return 1 - (choice.totalVotes / totalVotes) * 100
  })

  return (
    <div>
      {choices.map((choice, index) => (
        <div key={`poll-${index}`} className="mb-2">
          <input
            className="mr-2 align-middle"
            type="radio"
            id={`choice-${index}`}
            disabled
            value={index}
          />

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
            </label>
            <span>
              {choice.totalVotes} (
              {`${Number((choice.totalVotes / totalVotes) * 100).toFixed(2)}%`})
            </span>
          </div>
        </div>
      ))}
      {isPollClosed ? <div className="text-sm">Poll closed</div> : null}
      {!isPollClosed ? (
        <div className="text-sm">
          Poll close in {formatDistance(status.endAt, currentTime)}
        </div>
      ) : null}
    </div>
  )
}
