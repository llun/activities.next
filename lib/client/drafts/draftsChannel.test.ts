import {
  FakeBroadcastChannel,
  installFakeBroadcastChannel
} from '@/lib/testing/fakeBroadcastChannel'

import {
  DRAFTS_CHANNEL_NAME,
  type DraftsMessage,
  isDraftsMessage,
  postDraftsMessage,
  resetDraftsChannelForTesting,
  subscribeDraftsMessages
} from './draftsChannel'

const changed: DraftsMessage = {
  type: 'changed',
  accountId: 'account-1',
  actorId: 'actor-1',
  draftId: 'd1'
}

describe('draftsChannel', () => {
  afterEach(() => {
    resetDraftsChannelForTesting()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('delivers to this tab’s subscribers synchronously, since BroadcastChannel does not echo', () => {
    installFakeBroadcastChannel()
    const listener = vi.fn()
    subscribeDraftsMessages(listener)

    postDraftsMessage(changed)

    expect(listener).toHaveBeenCalledExactlyOnceWith(changed)
  })

  it('reaches a second channel of the same name', () => {
    installFakeBroadcastChannel()
    const otherTab = new FakeBroadcastChannel(DRAFTS_CHANNEL_NAME)
    const received = vi.fn()
    otherTab.onmessage = (event) => received(event.data)

    postDraftsMessage({ type: 'signing-out', accountId: 'account-1' })

    expect(received).toHaveBeenCalledExactlyOnceWith({
      type: 'signing-out',
      accountId: 'account-1'
    })
  })

  it('hands a message from another tab to subscribers and ignores malformed ones', () => {
    installFakeBroadcastChannel()
    const listener = vi.fn()
    subscribeDraftsMessages(listener)
    const otherTab = new FakeBroadcastChannel(DRAFTS_CHANNEL_NAME)

    otherTab.postMessage({ type: 'unknown', accountId: 'account-1' })
    otherTab.postMessage('garbage')
    otherTab.postMessage(null)
    otherTab.postMessage(changed)

    expect(listener).toHaveBeenCalledExactlyOnceWith(changed)
  })

  it('stops delivering after unsubscribe', () => {
    installFakeBroadcastChannel()
    const listener = vi.fn()
    const unsubscribe = subscribeDraftsMessages(listener)
    unsubscribe()

    postDraftsMessage(changed)

    expect(listener).not.toHaveBeenCalled()
  })

  it('still delivers locally without BroadcastChannel', () => {
    vi.stubGlobal('BroadcastChannel', undefined)
    const listener = vi.fn()
    subscribeDraftsMessages(listener)

    expect(() => postDraftsMessage(changed)).not.toThrow()

    expect(listener).toHaveBeenCalledExactlyOnceWith(changed)
  })

  it('still notifies this tab when the channel throws on post', () => {
    installFakeBroadcastChannel()
    const listener = vi.fn()
    subscribeDraftsMessages(listener)
    vi.spyOn(FakeBroadcastChannel.prototype, 'postMessage').mockImplementation(
      () => {
        throw new Error('closed')
      }
    )

    postDraftsMessage(changed)

    expect(listener).toHaveBeenCalledOnce()
  })

  describe('queue-progress', () => {
    const progress = {
      phase: 'sending',
      index: 1,
      total: 3,
      sent: 0,
      needsReview: 0,
      failed: 0,
      paused: 0
    } as const
    const queueProgress: DraftsMessage = {
      type: 'queue-progress',
      accountId: 'account-1',
      actorId: 'actor-1',
      progress
    }

    it('reaches this tab and another tab', () => {
      installFakeBroadcastChannel()
      const listener = vi.fn()
      subscribeDraftsMessages(listener)
      const otherTab = new FakeBroadcastChannel(DRAFTS_CHANNEL_NAME)
      const received = vi.fn()
      otherTab.onmessage = (event) => received(event.data)

      postDraftsMessage(queueProgress)

      expect(listener).toHaveBeenCalledExactlyOnceWith(queueProgress)
      expect(received).toHaveBeenCalledExactlyOnceWith(queueProgress)
    })

    it('is accepted from another tab only when well formed', () => {
      installFakeBroadcastChannel()
      const listener = vi.fn()
      subscribeDraftsMessages(listener)
      const otherTab = new FakeBroadcastChannel(DRAFTS_CHANNEL_NAME)

      otherTab.postMessage({ ...queueProgress, actorId: undefined })
      otherTab.postMessage({ ...queueProgress, progress: undefined })
      otherTab.postMessage({
        ...queueProgress,
        progress: { ...progress, phase: 'nope' }
      })
      otherTab.postMessage({
        ...queueProgress,
        progress: { ...progress, sent: '1' }
      })
      expect(listener).not.toHaveBeenCalled()

      otherTab.postMessage(queueProgress)
      expect(listener).toHaveBeenCalledExactlyOnceWith(queueProgress)
    })
  })

  describe('isDraftsMessage', () => {
    it.each([
      [{ type: 'changed', accountId: 'a' }, true],
      [{ type: 'signing-out', accountId: 'a' }, true],
      [{ type: 'sign-out-cancelled', accountId: 'a' }, true],
      [{ type: 'signing-out' }, false],
      [{ type: 'other', accountId: 'a' }, false],
      [null, false],
      ['text', false]
    ])('%j -> %s', (value, expected) => {
      expect(isDraftsMessage(value)).toBe(expected)
    })
  })
})
