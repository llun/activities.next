import { FC } from 'react'

import { StatusData, StatusType } from '../../models/status'

interface Props {
  status: StatusData
}

export const Poll: FC<Props> = ({ status }) => {
  if (status.type !== StatusType.Poll) return null
  if (!status.choices) return null

  const choices = status.choices
  return (
    <div>
      {choices.map((choice) => (
        <div key={choice.title}>{choice.title}</div>
      ))}
    </div>
  )
}
