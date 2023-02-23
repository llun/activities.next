import { FC, useState } from 'react'

import { Button } from '../Button'

interface Choice {
  text: string
}

interface Props {
  show: boolean
}

export const PollChoices: FC<Props> = ({ show }) => {
  const [choices, setChoices] = useState<Choice[]>([{ text: '' }, { text: '' }])

  if (!show) return null

  const addChoice = () => {
    setChoices((previouse) => [...previouse, { text: '' }])
  }

  const removeChoice = (index: number) => {
    if (choices.length < 2) return
    console.log(choices[index])
    setChoices([...choices.slice(0, index), ...choices.slice(index + 1)])
  }

  return (
    <div>
      {choices.map((choice, index) => {
        return (
          <div key={index} className="mb-1 d-flex flex-row">
            <input
              className="form-control"
              type="text"
              placeholder={`Choice ${index + 1}`}
              defaultValue={choice.text}
            />
            <Button variant="link" onClick={() => removeChoice(index)}>
              <i className="bi bi-x-circle-fill" />
            </Button>
          </div>
        )
      })}
      <Button onClick={() => addChoice()}>Add choice</Button>
    </div>
  )
}
