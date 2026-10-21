import type { ConnectionSnapshot } from '@/lib/client/connection'
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
})
