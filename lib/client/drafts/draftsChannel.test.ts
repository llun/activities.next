import {
  FakeBroadcastChannel,
  installFakeBroadcastChannel
} from '@/lib/testing/fakeBroadcastChannel'

import {
  DRAFTS_CHANNEL_NAME,
  type DraftsMessage,
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
})
