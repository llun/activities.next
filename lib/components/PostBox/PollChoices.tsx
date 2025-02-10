'use client'

import cn from 'classnames'
import { FC, useState } from 'react'

import { Button } from '@/lib/components/Button'

export const DEFAULT_DURATION = 21_600

export const SecondsToDurationText = {
  300: '5 Minutes',
  1_800: '30 Minutes',
  3_600: '1 Hour',
  21_600: '6 Hours',
  43_200: '12 Hours',
  86_400: '1 Day',
  259_200: '3 Days',
  604_800: '7 Days'
}

export type Duration = keyof typeof SecondsToDurationText

export interface Choice {
  key: number
  text: string
}

interface Props {
  show: boolean
  choices: Choice[]
  durationInSeconds: Duration
  onAddChoice: () => void
  onRemoveChoice: (index: number) => void
  onChooseDuration: (durationInSeconds: Duration) => void
}

export const PollChoices: FC<Props> = ({
  show,
  choices,
  durationInSeconds,
  onAddChoice,
  onRemoveChoice,
  onChooseDuration
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
            {SecondsToDurationText[durationInSeconds]}
          </button>
          <div
            className={cn('dropdown-menu mt-1', { show: showDurationDropdown })}
            aria-labelledby="dropdownMenuButton"
          >
            {Object.keys(SecondsToDurationText).map((duration) => (
              <a
                className="dropdown-item"
                href="#"
                key={duration}
                onClick={(event) => {
                  event.preventDefault()
                  setShowDurationDropdown(false)
                  onChooseDuration(parseInt(duration) as Duration)
                }}
              >
                {SecondsToDurationText[parseInt(duration) as Duration]}
              </a>
            ))}
          </div>
        </div>
        <Button disabled={choices.length >= 5} onClick={() => onAddChoice()}>
          Add choice
        </Button>
      </div>
    </div>
  )
}
