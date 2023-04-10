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
  return (
    <div>
      {choices.map((choice, index) => (
        <div key={choice.title} className="form-check">
          <input
            className="form-check-input"
            type="radio"
            id={`choice-${index}`}
            disabled
            value={index}
          />

          <div className="d-flex">
            <label
              className="form-check-label flex-fill"
              htmlFor={`choice-${index}`}
            >
              {choice.title}
            </label>
            <span>
              {choice.totalVotes} (
              {`${(choice.totalVotes / totalVotes) * 100}%`})
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
