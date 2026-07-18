import { Reducer } from 'react'

import { EditableStatus, Status } from '@/lib/types/domain/status'

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

export const quoteAction = (status: Status) => ({
  type: 'quote' as const,
  status
})
export type QuoteAction = ReturnType<typeof quoteAction>

export const clearAction = () => ({ type: 'clear' as const })
export type ClearAction = ReturnType<typeof clearAction>

export const statusActionReducer: Reducer<
  { replyStatus?: Status; editStatus?: EditableStatus; quoteStatus?: Status },
  ReplyAction | EditAction | QuoteAction | ClearAction
> = (state, action) => {
  switch (action.type) {
    case 'edit':
      return { editStatus: action.status }
    case 'reply':
      return { replyStatus: action.status }
    case 'quote':
      return { quoteStatus: action.status }
    default: {
      return {}
    }
  }
}
