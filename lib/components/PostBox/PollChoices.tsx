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

  return (
    <div>
      {choices.map((choice, index) => {
        return (
          <div key={index} className="mb-1">
            <input
              className="form-control"
              type="text"
              placeholder={`Choice ${index + 1}`}
              defaultValue={choice.text}
            />
          </div>
        )
      })}
      <Button onClick={() => addChoice()}>Add choice</Button>
    </div>
  )
}
