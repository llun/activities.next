import { FC, useState } from 'react'

import { Button } from '../Button'

interface Choice {
  key: number
  text: string
}

interface Props {
  show: boolean
}

const key = () => Math.round(Math.random() * 1000)

export const PollChoices: FC<Props> = ({ show }) => {
  const [choices, setChoices] = useState<Choice[]>([
    { key: key(), text: '' },
    { key: key(), text: '' }
  ])

  if (!show) return null

  const addChoice = () => {
    if (choices.length > 4) return
    setChoices((previous) => [...previous, { key: key(), text: '' }])
  }

  const removeChoice = (index: number) => {
    if (choices.length < 3) return
    setChoices([...choices.slice(0, index), ...choices.slice(index + 1)])
  }

  console.log(choices)
  return (
    <div>
      {choices.map((choice, index) => (
        <div key={choice.key} className="mb-1 d-flex flex-row">
          <input
            className="form-control"
            type="text"
            placeholder={`Choice ${index + 1}`}
            defaultValue={choice.text}
            onChange={(e) => {
              choice.text = e.currentTarget.value
            }}
          />
          <Button
            disabled={choices.length < 3}
            variant="link"
            onClick={() => removeChoice(index)}
          >
            <i className="bi bi-x-circle-fill" />
          </Button>
        </div>
      ))}
      <Button disabled={choices.length >= 5} onClick={() => addChoice()}>
        Add choice
      </Button>
    </div>
  )
}
