import { Reducer } from 'react'

import { EditableStatus, Status } from '@/lib/models/status'

export const replyAction = (status: Status) => ({
  type: 'reply' as const,
  status
})
export type ReplyAction = ReturnType<typeof replyAction>

export const editAction = (status: EditableStatus) => ({
  type: 'edit' as const,
  status
})
export type EditAction = ReturnType<typeof editAction>

export const clearAction = () => ({ type: 'clear' as const })
export type ClearAction = ReturnType<typeof clearAction>

export const statusActionReducer: Reducer<
  { replyStatus?: Status; editStatus?: EditableStatus },
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
