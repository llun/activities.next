import { FC } from 'react'

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
      <Button disabled={choices.length >= 5} onClick={() => onAddChoice()}>
        Add choice
      </Button>
    </div>
  )
}
