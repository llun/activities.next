import type { ConnectionSnapshot } from '@/lib/client/connection'
import type { SendQueueProgress } from '@/lib/client/drafts/types'
import { getSlotMessage } from '@/lib/components/connection/slotMessage'

const snapshot = (patch: Partial<ConnectionSnapshot>): ConnectionSnapshot => ({
  state: 'online',
  nextProbeAt: null,
  probing: false,
  ...patch
})

describe('getSlotMessage', () => {
  it('is hidden while online', () => {
    expect(getSlotMessage(snapshot({}), 'llun.test')).toBeNull()
  })

  it('says "You\'re offline." with no detail and no retry', () => {
    expect(getSlotMessage(snapshot({ state: 'offline' }), 'llun.test')).toEqual(
      { kind: 'offline', title: "You're offline." }
    )
  })

  it('names the host and counts down, rounding the seconds up', () => {
    const message = getSlotMessage(
      snapshot({ state: 'unreachable', nextProbeAt: 10_001 }),
      'llun.test',
      0
    )

    expect(message).toEqual({
      kind: 'unreachable',
      title: "Can't reach llun.test.",
      detail: 'Trying again in 11 s',
      retry: true
    })
  })

  it('never shows less than one second', () => {
    const message = getSlotMessage(
      snapshot({ state: 'unreachable', nextProbeAt: 100 }),
      'llun.test',
      5_000
    )

    expect(message?.detail).toBe('Trying again in 1 s')
  })

  it('says it is trying now while a probe is in flight, and has no detail when none is scheduled', () => {
    expect(
      getSlotMessage(
        snapshot({ state: 'unreachable', probing: true, nextProbeAt: 9_999 }),
        'llun.test',
        0
      )?.detail
    ).toBe('Trying again now')
    expect(
      getSlotMessage(snapshot({ state: 'unreachable' }), 'llun.test')?.detail
    ).toBeUndefined()
  })

  describe('with the send queue', () => {
    const queue = (patch: Partial<SendQueueProgress>): SendQueueProgress => ({
      phase: 'idle',
      index: 0,
      total: 0,
      sent: 0,
      needsReview: 0,
      failed: 0,
      paused: 0,
      ...patch
    })
    const message = (
      patch: Partial<SendQueueProgress>,
      state: ConnectionSnapshot['state'] = 'online'
    ) => getSlotMessage(snapshot({ state }), 'llun.test', 0, queue(patch))

    it('says "Back online" with the count while sending, one post or many', () => {
      expect(message({ phase: 'sending', index: 2, total: 5 })).toEqual({
        kind: 'sending',
        title: 'Back online',
        detail: 'Sending 2 of 5 posts'
      })
      expect(message({ phase: 'sending', index: 1, total: 1 })?.detail).toBe(
        'Sending 1 of 1 post'
      )
    })

    it('keeps the title the same on every index, so the announcer says it once', () => {
      expect(message({ phase: 'sending', index: 1, total: 3 })?.title).toBe(
        message({ phase: 'sending', index: 3, total: 3 })?.title
      )
    })

    it('says a failed Pause in the title, keeping the count', () => {
      expect(
        getSlotMessage(snapshot({ state: 'online' }), 'llun.test', 0, {
          ...queue({ phase: 'sending', index: 1, total: 2 }),
          pauseFailed: true
        })
      ).toEqual({
        kind: 'sending',
        title: "Couldn't pause sending.",
        detail: 'Sending 1 of 2 posts'
      })
    })

    it('joins only the non-zero parts of a result', () => {
      expect(
        message({
          phase: 'result',
          sent: 2,
          needsReview: 1,
          failed: 3,
          paused: 4
        })
      ).toEqual({
        kind: 'result',
        title: "2 posts sent · 1 needs review · 3 couldn't send · 4 paused"
      })
      expect(message({ phase: 'result', sent: 1 })?.title).toBe('1 post sent')
      expect(message({ phase: 'result', needsReview: 2 })?.title).toBe(
        '2 need review'
      )
      expect(message({ phase: 'result', paused: 1, failed: 1 })?.title).toBe(
        "1 couldn't send · 1 paused"
      )
    })

    it('takes precedence over a connection message', () => {
      expect(
        message({ phase: 'sending', index: 1, total: 1 }, 'offline')?.kind
      ).toBe('sending')
      expect(message({ phase: 'result', sent: 1 }, 'unreachable')?.kind).toBe(
        'result'
      )
    })

    it('falls back to the connection message for idle, null, and an all-zero result', () => {
      expect(message({ phase: 'idle' })).toBeNull()
      expect(message({ phase: 'idle' }, 'offline')?.kind).toBe('offline')
      expect(message({ phase: 'result' })).toBeNull()
      expect(message({ phase: 'result' }, 'offline')?.kind).toBe('offline')
      expect(
        getSlotMessage(snapshot({ state: 'offline' }), 'llun.test', 0, null)
          ?.kind
      ).toBe('offline')
    })
  })
})
