import { EditableStatus, Status } from '@/lib/types/domain/status'

import {
  clearAction,
  editAction,
  quoteAction,
  replyAction,
  statusActionReducer
} from './reducer'

const status = { id: 'https://llun.test/users/a/statuses/1' } as Status

describe('statusActionReducer', () => {
  it('sets quoteStatus (and only that) on a quote action', () => {
    const next = statusActionReducer(
      { replyStatus: status },
      quoteAction(status)
    )
    expect(next).toEqual({ quoteStatus: status })
  })

  it('sets replyStatus on a reply action', () => {
    expect(statusActionReducer({}, replyAction(status))).toEqual({
      replyStatus: status
    })
  })

  it('sets editStatus on an edit action', () => {
    const editable = status as unknown as EditableStatus
    expect(statusActionReducer({}, editAction(editable))).toEqual({
      editStatus: editable
    })
  })

  it('clears all pending actions on clear', () => {
    expect(statusActionReducer({ quoteStatus: status }, clearAction())).toEqual(
      {}
    )
  })
})
