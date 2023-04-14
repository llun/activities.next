import { FC } from 'react'

import { StatusData, StatusType } from '../../models/status'

interface Props {
  status: StatusData
  currentTime: Date
}

export const Poll: FC<Props> = ({ status, currentTime }) => {
  if (status.type !== StatusType.Poll) return null
  if (!status.choices) return null

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
        <div key={`poll-${index}`} className="form-check">
          <input
            className="form-check-input"
            type="radio"
            id={`choice-${index}`}
            disabled
            value={index}
          />

          <div
            className="d-flex"
            style={{
              background: `linear-gradient(90deg, pink ${
                (choice.totalVotes / totalVotes) * 100
              }%, rgba(255,255,255, 0) ${backgroundRevertPercentage[index]}%)`
            }}
          >
            <label
              className="form-check-label flex-fill"
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
      {currentTime.getTime() > status.endAt ? (
        <div className="fs-6">Poll closed</div>
      ) : null}
    </div>
  )
}
