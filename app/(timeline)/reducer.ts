import { Reducer } from 'react'

import { EditableStatusData, StatusData } from '@/lib/models/status'

export const replyAction = (status: StatusData) => ({
  type: 'reply' as const,
  status
})
export type ReplyAction = ReturnType<typeof replyAction>

export const editAction = (status: EditableStatusData) => ({
  type: 'edit' as const,
  status
})
export type EditAction = ReturnType<typeof editAction>

export const clearAction = () => ({ type: 'clear' as const })
export type ClearAction = ReturnType<typeof clearAction>

export const statusActionReducer: Reducer<
  { replyStatus?: StatusData; editStatus?: EditableStatusData },
  ReplyAction | EditAction | ClearAction
> = (state, action) => {
  switch (action.type) {
    case 'edit':
      return { editStatus: action.status }
    case 'reply':
      return { replyStatus: action.status }
    default: {
      return {}
    }
  }
}
