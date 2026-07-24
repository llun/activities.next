import { SecondsToDurationText } from '@/lib/services/statuses/pollDurations'

import { CreatePollRequest } from './types'

describe('CreatePollRequest', () => {
  const basePoll = {
    type: 'poll' as const,
    message: 'pick one',
    choices: ['a', 'b']
  }

  // Every duration the composer's poll picker offers must validate. A previous
  // `Object.keys(...).map(parseInt)` passed the array index as the radix, so all
  // but the first key were mangled. (The table itself was also empty on the
  // server until the durations moved out of the 'use client' poll editor — see
  // lib/clientModuleBoundary.test.ts — so in practice nothing validated.)
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

  // The structural floor has to match PollSchema in app/api/v1/statuses, or the
  // two create endpoints disagree about what a well-formed poll is.
  it.each([
    {
      description: 'rejects fewer than two choices',
      choices: ['only one'],
      expected: false
    },
    {
      description: 'rejects a blank choice',
      choices: ['a', '  '],
      expected: false
    },
    {
      description: 'accepts two non-blank choices',
      choices: ['a', 'b'],
      expected: true
    }
  ])('$description', ({ choices, expected }) => {
    const parsed = CreatePollRequest.safeParse({
      ...basePoll,
      choices,
      durationInSeconds: 300
    })
    expect(parsed.success).toBe(expected)
  })
})
