import { updateStatusInteractionPolicyFromUserInput } from '@/lib/actions/updateStatusInteractionPolicy'
import { Database } from '@/lib/database/types'
import { SEND_UPDATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { Actor } from '@/lib/types/domain/actor'
import { Status, StatusType } from '@/lib/types/domain/status'

const publish = vi.fn()

vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({
    publish
  })
}))

const makeActor = (id: string = 'https://llun.test/users/alice'): Actor =>
  ({
    id,
    username: 'alice',
    domain: 'llun.test',
    account: { id: 'acc-1' }
  }) as unknown as Actor

const makeStatus = (overrides: Partial<Status> = {}): Status =>
  ({
    id: 'https://llun.test/users/alice/statuses/1',
    type: StatusType.enum.Note,
    actorId: 'https://llun.test/users/alice',
    isLocalActor: true,
    text: 'Hello world',
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides
  }) as unknown as Status

describe('updateStatusInteractionPolicyFromUserInput', () => {
  const currentActor = makeActor()
  let database: Database
  let getStatus: ReturnType<typeof vi.fn>
  let updateStatusQuoteApprovalPolicy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    publish.mockReset()
    getStatus = vi.fn().mockResolvedValue(makeStatus())
    updateStatusQuoteApprovalPolicy = vi
      .fn()
      .mockImplementation(async ({ quoteApprovalPolicy }) =>
        makeStatus({ quoteApprovalPolicy })
      )
    database = {
      getStatus,
      updateStatusQuoteApprovalPolicy
    } as unknown as Database
  })

  it('updates interaction policy and publishes note update job without modifying updatedAt', async () => {
    const status = makeStatus()
    const result = await updateStatusInteractionPolicyFromUserInput({
      statusId: status.id,
      currentActor,
      quoteApprovalPolicy: 'nobody',
      database
    })

    expect(result).not.toBeNull()
    expect(updateStatusQuoteApprovalPolicy).toHaveBeenCalledWith({
      statusId: status.id,
      quoteApprovalPolicy: 'nobody'
    })
    // updatedAt is preserved unchanged
    expect(result?.updatedAt).toBe(status.updatedAt)

    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: SEND_UPDATE_NOTE_JOB_NAME,
        data: {
          actorId: currentActor.id,
          statusId: status.id
        }
      })
    )
  })

  it('gives the same job id on redelivery of the same logical operationId', async () => {
    const status = makeStatus()
    const operationId = 'op-fixed-123'

    await updateStatusInteractionPolicyFromUserInput({
      statusId: status.id,
      currentActor,
      quoteApprovalPolicy: 'nobody',
      operationId,
      database
    })
    const firstJobId = publish.mock.calls[0][0].id

    publish.mockReset()
    await updateStatusInteractionPolicyFromUserInput({
      statusId: status.id,
      currentActor,
      quoteApprovalPolicy: 'nobody',
      operationId,
      database
    })
    const secondJobId = publish.mock.calls[0][0].id

    expect(secondJobId).toBe(firstJobId)
  })

  it('gives different job ids for repeated policy changes without changing updatedAt or edit history', async () => {
    const status = makeStatus()

    await updateStatusInteractionPolicyFromUserInput({
      statusId: status.id,
      currentActor,
      quoteApprovalPolicy: 'nobody',
      database
    })
    const firstJobId = publish.mock.calls[0][0].id

    publish.mockReset()
    await updateStatusInteractionPolicyFromUserInput({
      statusId: status.id,
      currentActor,
      quoteApprovalPolicy: 'public',
      database
    })
    const secondJobId = publish.mock.calls[0][0].id

    expect(secondJobId).not.toBe(firstJobId)
  })

  it('returns null and does not publish if caller is not the status author', async () => {
    const otherActor = makeActor('https://llun.test/users/bob')
    const result = await updateStatusInteractionPolicyFromUserInput({
      statusId: 'https://llun.test/users/alice/statuses/1',
      currentActor: otherActor,
      quoteApprovalPolicy: 'nobody',
      database
    })

    expect(result).toBeNull()
    expect(updateStatusQuoteApprovalPolicy).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('returns null and does not publish if status type is Announce', async () => {
    getStatus.mockResolvedValue(
      makeStatus({ type: StatusType.enum.Announce as StatusType })
    )

    const result = await updateStatusInteractionPolicyFromUserInput({
      statusId: 'https://llun.test/users/alice/statuses/1',
      currentActor,
      quoteApprovalPolicy: 'nobody',
      database
    })

    expect(result).toBeNull()
    expect(updateStatusQuoteApprovalPolicy).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })
})
