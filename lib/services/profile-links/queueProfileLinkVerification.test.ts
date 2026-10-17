import { VERIFY_PROFILE_LINKS_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'

import { queueProfileLinkVerification } from './queueProfileLinkVerification'

const publish = vi.fn()
vi.mock('@/lib/services/queue', () => ({ getQueue: vi.fn() }))

const ACTOR_ID = 'https://llun.test/users/anna'

describe('queueProfileLinkVerification', () => {
  beforeEach(() => {
    publish.mockReset()
    publish.mockResolvedValue(undefined)
    vi.mocked(getQueue).mockReturnValue({
      runsInline: false,
      publish,
      handle: vi.fn()
    } as unknown as ReturnType<typeof getQueue>)
  })

  it('queues the check when a value changed', async () => {
    await queueProfileLinkVerification({
      actorId: ACTOR_ID,
      before: [{ value: 'https://a.example' }],
      after: [{ value: 'https://b.example' }],
      remote: false
    })

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: VERIFY_PROFILE_LINKS_JOB_NAME,
        data: { actorId: ACTOR_ID }
      })
    )
  })

  it('queues the check for a newly created actor with fields', async () => {
    await queueProfileLinkVerification({
      actorId: ACTOR_ID,
      before: undefined,
      after: [{ value: 'https://a.example' }],
      remote: false
    })

    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('queues nothing when the values are unchanged and not verifiable', async () => {
    await queueProfileLinkVerification({
      actorId: ACTOR_ID,
      before: [{ value: 'plain text' }],
      after: [{ value: 'plain text' }],
      remote: false
    })

    expect(publish).not.toHaveBeenCalled()
  })

  it('queues nothing when there are no fields', async () => {
    await queueProfileLinkVerification({
      actorId: ACTOR_ID,
      before: [{ value: 'https://a.example' }],
      after: [],
      remote: false
    })

    expect(publish).not.toHaveBeenCalled()
  })

  it('does not throw when the queue refuses the job', async () => {
    publish.mockRejectedValue(new Error('queue down'))

    await expect(
      queueProfileLinkVerification({
        actorId: ACTOR_ID,
        before: undefined,
        after: [{ value: 'https://a.example' }],
        remote: false
      })
    ).resolves.toBeUndefined()
  })
})

describe('queueProfileLinkVerification re-checks', () => {
  beforeEach(() => {
    publish.mockReset()
    publish.mockResolvedValue(undefined)
    vi.mocked(getQueue).mockReturnValue({
      runsInline: false,
      publish,
      handle: vi.fn()
    } as unknown as ReturnType<typeof getQueue>)
  })

  it('queues when unchanged values are verifiable but not verified', async () => {
    const fields = [{ name: 'Blog', value: 'https://a.example' }]
    await queueProfileLinkVerification({
      actorId: ACTOR_ID,
      before: fields,
      after: fields,
      remote: false
    })

    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('queues nothing when unchanged values are all verified', async () => {
    await queueProfileLinkVerification({
      actorId: ACTOR_ID,
      before: [{ name: 'Blog', value: 'https://a.example', verifiedAt: 1 }],
      after: [{ name: 'Blog', value: 'https://a.example' }],
      remote: false
    })

    expect(publish).not.toHaveBeenCalled()
  })

  it('queues for a changed value even when another field is verified', async () => {
    await queueProfileLinkVerification({
      actorId: ACTOR_ID,
      before: [{ name: 'Blog', value: 'https://a.example', verifiedAt: 1 }],
      after: [
        { name: 'Blog', value: 'https://a.example' },
        { name: 'Site', value: 'https://b.example' }
      ],
      remote: false
    })

    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('queues nothing for empty, plain-text or http values', async () => {
    await queueProfileLinkVerification({
      actorId: ACTOR_ID,
      before: undefined,
      after: [
        { name: 'Pronouns', value: 'they/them' },
        { name: 'Old', value: 'http://a.example' },
        { name: 'Blank', value: '' }
      ],
      remote: false
    })

    expect(publish).not.toHaveBeenCalled()
  })

  it('reads a remote value as HTML', async () => {
    const html = '<a href="https://a.example/" rel="me">https://a.example/</a>'
    await queueProfileLinkVerification({
      actorId: ACTOR_ID,
      before: [{ name: 'Web', value: html }],
      after: [{ name: 'Web', value: html }],
      remote: true
    })
    expect(publish).toHaveBeenCalledTimes(1)

    publish.mockClear()
    await queueProfileLinkVerification({
      actorId: ACTOR_ID,
      before: undefined,
      after: [{ name: 'Web', value: 'https://a.example/' }],
      remote: false
    })
    expect(publish).toHaveBeenCalledTimes(1)
  })

  describe('render path (renderCheckedAt)', () => {
    const fields = [{ name: 'Blog', value: 'https://a.example' }]
    const changed = [{ name: 'Blog', value: 'https://b.example' }]
    const run = (
      after: typeof fields,
      renderCheckedAt: number | null | undefined
    ) =>
      queueProfileLinkVerification({
        actorId: ACTOR_ID,
        before: fields,
        after,
        remote: true,
        renderCheckedAt
      })

    it('skips changed and unchanged unverified values checked recently', async () => {
      await run(changed, Date.now() - 60_000)
      await run(fields, Date.now() - 60_000)
      expect(publish).not.toHaveBeenCalled()
    })

    it('rechecks a changed value after an hour but an unchanged one only after 3 days', async () => {
      const twoHoursAgo = Date.now() - 2 * 3_600_000
      await run(fields, twoHoursAgo)
      expect(publish).not.toHaveBeenCalled()
      await run(changed, twoHoursAgo)
      expect(publish).toHaveBeenCalledTimes(1)

      await run(fields, Date.now() - 4 * 86_400_000)
      expect(publish).toHaveBeenCalledTimes(2)
    })

    it('queues when the actor was never checked', async () => {
      await run(fields, null)
      expect(publish).toHaveBeenCalledTimes(1)
    })
  })

  it('ignores any stamp when renderCheckedAt is not passed (local saves)', async () => {
    const fields = [{ name: 'Blog', value: 'https://a.example' }]
    await queueProfileLinkVerification({
      actorId: ACTOR_ID,
      before: fields,
      after: fields,
      remote: false
    })
    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('gives the same state the same id within a window, another state another', async () => {
    const fields = [{ name: 'Blog', value: 'https://a.example' }]
    const run = (after: { name: string; value: string }[]) =>
      queueProfileLinkVerification({
        actorId: ACTOR_ID,
        before: undefined,
        after,
        remote: false
      })
    await run(fields)
    await run(fields)
    await run([{ name: 'Blog', value: 'https://b.example' }])

    const ids = publish.mock.calls.map(([message]) => message.id)
    expect(ids[0]).toBe(ids[1])
    expect(ids[2]).not.toBe(ids[0])
  })
})
