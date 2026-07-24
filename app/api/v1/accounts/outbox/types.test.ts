import { SecondsToDurationText } from '@/lib/components/post-box/poll-durations'

import { CreatePollRequest } from './types'

describe('CreatePollRequest', () => {
  const basePoll = {
    type: 'poll' as const,
    message: 'pick one',
    choices: ['a', 'b']
  }

  // Every duration the composer's poll picker offers must validate. A previous
  // `Object.keys(...).map(parseInt)` passed the array index as the radix, so
  // only the first key survived and the composer could create nothing but
  // 5-minute polls.
  it.each(
    Object.keys(SecondsToDurationText).map((seconds) => ({
      description: `accepts the ${SecondsToDurationText[Number(seconds) as keyof typeof SecondsToDurationText]} duration`,
      durationInSeconds: Number(seconds)
    }))
  )('$description', ({ durationInSeconds }) => {
    const parsed = CreatePollRequest.safeParse({
      ...basePoll,
      durationInSeconds
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects a duration the composer does not offer', () => {
    const parsed = CreatePollRequest.safeParse({
      ...basePoll,
      durationInSeconds: 12_345
    })
    expect(parsed.success).toBe(false)
  })
})
