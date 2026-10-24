import { describe, expect, it } from 'vitest'

import {
  unsentPostsDetail,
  unsentPostsMessage,
  unsentPostsTitle
} from './unsentPostsMessage'

describe('unsentPostsMessage', () => {
  it('returns empty string when waiting and drafts are 0', () => {
    expect(unsentPostsMessage({ waiting: 0, drafts: 0 })).toBe('')
  })

  it('formats correctly when only 1 post is waiting to send', () => {
    expect(unsentPostsMessage({ waiting: 1, drafts: 0 })).toBe(
      '1 post on this device has not been sent. 1 is waiting to send. They are saved only on this device, so signing out deletes them and they cannot be restored.'
    )
  })

  it('formats correctly when only 2 posts are waiting to send', () => {
    expect(unsentPostsMessage({ waiting: 2, drafts: 0 })).toBe(
      '2 posts on this device have not been sent. 2 are waiting to send. They are saved only on this device, so signing out deletes them and they cannot be restored.'
    )
  })

  it('formats correctly when only 1 draft is present', () => {
    expect(unsentPostsMessage({ waiting: 0, drafts: 1 })).toBe(
      '1 post on this device has not been sent. 1 is a draft. They are saved only on this device, so signing out deletes them and they cannot be restored.'
    )
  })

  it('formats correctly when only 2 drafts are present', () => {
    expect(unsentPostsMessage({ waiting: 0, drafts: 2 })).toBe(
      '2 posts on this device have not been sent. 2 are drafts. They are saved only on this device, so signing out deletes them and they cannot be restored.'
    )
  })

  it('formats correctly with 1 waiting and 1 draft', () => {
    expect(unsentPostsMessage({ waiting: 1, drafts: 1 })).toBe(
      '2 posts on this device have not been sent. 1 is waiting to send and 1 is a draft. They are saved only on this device, so signing out deletes them and they cannot be restored.'
    )
  })

  it('formats correctly with 1 waiting and 2 drafts', () => {
    expect(unsentPostsMessage({ waiting: 1, drafts: 2 })).toBe(
      '3 posts on this device have not been sent. 1 is waiting to send and 2 are drafts. They are saved only on this device, so signing out deletes them and they cannot be restored.'
    )
  })

  it('formats correctly with 2 waiting and 1 draft', () => {
    expect(unsentPostsMessage({ waiting: 2, drafts: 1 })).toBe(
      '3 posts on this device have not been sent. 2 are waiting to send and 1 is a draft. They are saved only on this device, so signing out deletes them and they cannot be restored.'
    )
  })

  it('formats correctly with 2 waiting and 2 drafts', () => {
    expect(unsentPostsMessage({ waiting: 2, drafts: 2 })).toBe(
      '4 posts on this device have not been sent. 2 are waiting to send and 2 are drafts. They are saved only on this device, so signing out deletes them and they cannot be restored.'
    )
  })
})

describe('unsentPostsTitle and unsentPostsDetail', () => {
  it('split the message into its bold first sentence and the rest', () => {
    expect(unsentPostsTitle({ waiting: 2, drafts: 1 })).toBe(
      '3 posts on this device have not been sent.'
    )
    expect(unsentPostsDetail({ waiting: 2, drafts: 1 })).toBe(
      '2 are waiting to send and 1 is a draft. They are saved only on this device, so signing out deletes them and they cannot be restored.'
    )
  })
})
