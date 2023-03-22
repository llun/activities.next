import cn from 'classnames'
import { FC, useState } from 'react'

import { Button } from '../Button'

export interface Choice {
  key: number
  text: string
}

interface Props {
  show: boolean
  choices: Choice[]
  onAddChoice: () => void
  onRemoveChoice: (index: number) => void
}

export const PollChoices: FC<Props> = ({
  show,
  choices,
  onAddChoice,
  onRemoveChoice
}) => {
  const [showDurationDropdown, setShowDurationDropdown] =
    useState<boolean>(false)

  if (!show) return null

  return (
    <div>
      {choices.map((choice, index) => (
        <div key={choice.key} className="mb-1 d-flex flex-row">
          <input
            className="form-control"
            type="text"
            name="poll[]"
            placeholder={`Choice ${index + 1}`}
            defaultValue={choice.text}
            onChange={(e) => {
              choice.text = e.currentTarget.value
            }}
          />
          <Button
            disabled={choices.length < 3}
            variant="link"
            onClick={() => onRemoveChoice(index)}
          >
            <i className="bi bi-x-circle-fill" />
          </Button>
        </div>
      ))}
      <div className="mb-1 d-flex flex-row">
        <div className="form-check py-1 me-2">
          <input
            className="form-check-input"
            type="checkbox"
            value=""
            id="flexCheckDefault"
          />
          <label className="form-check-label" htmlFor="flexCheckDefault">
            Multiple Choices
          </label>
        </div>
        <div className={cn('dropdown me-2', { show: showDurationDropdown })}>
          <button
            className="btn btn-secondary dropdown-toggle"
            type="button"
            id="dropdownMenuButton"
            data-toggle="dropdown"
            aria-haspopup="true"
            aria-expanded="false"
            onClick={() => setShowDurationDropdown(!showDurationDropdown)}
          >
            6 hours
          </button>
          <div
            className={cn('dropdown-menu mt-1', { show: showDurationDropdown })}
            aria-labelledby="dropdownMenuButton"
          >
            <a className="dropdown-item" href="#">
              5 minutes
            </a>
            <a className="dropdown-item" href="#">
              30 minutes
            </a>
            <a className="dropdown-item" href="#">
              1 hours
            </a>
            <a className="dropdown-item" href="#">
              6 hours
            </a>
            <a className="dropdown-item" href="#">
              12 hours
            </a>
            <a className="dropdown-item" href="#">
              1 day
            </a>
            <a className="dropdown-item" href="#">
              3 days
            </a>
            <a className="dropdown-item" href="#">
              7 days
            </a>
          </div>
        </div>
        <Button disabled={choices.length >= 5} onClick={() => onAddChoice()}>
          Add choice
        </Button>
      </div>
    </div>
  )
}
