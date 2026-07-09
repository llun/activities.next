import { sendFlag } from '@/lib/activities'
import { Database } from '@/lib/database/types'
import { SEND_FLAG_JOB_NAME } from '@/lib/jobs/names'
import { sendFlagJob } from '@/lib/jobs/sendFlagJob'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'

vi.mock('@/lib/activities', () => ({
  sendFlag: vi.fn()
}))

vi.mock('@/lib/services/federation/domainPolicy', () => ({
  canFederateWithDomain: vi.fn()
}))

vi.mock('@/lib/services/federation/getFederationSigningActor', () => ({
  getFederationSigningActor: vi.fn()
}))

const SIGNING_ACTOR = {
  id: 'https://local.test/actor',
  domain: 'local.test'
}
const TARGET = 'https://remote.test/users/alice'

const createDatabase = (getActorFromId = vi.fn().mockResolvedValue(null)) =>
  ({ getActorFromId }) as unknown as Database

const runJob = (database: Database, data: unknown) =>
  sendFlagJob(database, {
    id: 'job-1',
    name: SEND_FLAG_JOB_NAME,
    data
  })

describe('sendFlagJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(canFederateWithDomain).mockResolvedValue(true)
    vi.mocked(getFederationSigningActor).mockResolvedValue(
      SIGNING_ACTOR as never
    )
    vi.mocked(sendFlag).mockResolvedValue({ ok: true, uri: 'flag-uri' })
  })

  it('forwards a Flag to a remote target signed by the instance actor', async () => {
    const database = createDatabase()

    await runJob(database, {
      reportId: 'report-1',
      targetActorId: TARGET,
      statusIds: ['https://remote.test/statuses/1'],
      content: 'spam'
    })

    expect(sendFlag).toHaveBeenCalledWith(
      expect.objectContaining({
        currentActor: SIGNING_ACTOR,
        signingActor: SIGNING_ACTOR,
        targetActorId: TARGET,
        objects: [TARGET, 'https://remote.test/statuses/1'],
        content: 'spam'
      })
    )
  })

  it('skips when federation with the target domain is off', async () => {
    vi.mocked(canFederateWithDomain).mockResolvedValue(false)
    const database = createDatabase()

    await runJob(database, {
      reportId: 'report-1',
      targetActorId: TARGET,
      statusIds: [],
      content: ''
    })

    expect(sendFlag).not.toHaveBeenCalled()
  })

  it('skips a local target (identified by a stored private key)', async () => {
    const database = createDatabase(
      vi.fn().mockResolvedValue({ id: TARGET, privateKey: 'secret' })
    )

    await runJob(database, {
      reportId: 'report-1',
      targetActorId: TARGET,
      statusIds: [],
      content: ''
    })

    expect(sendFlag).not.toHaveBeenCalled()
  })

  it('skips when no federation signing actor is available', async () => {
    vi.mocked(getFederationSigningActor).mockResolvedValue(undefined)
    const database = createDatabase()

    await runJob(database, {
      reportId: 'report-1',
      targetActorId: TARGET,
      statusIds: [],
      content: ''
    })

    expect(sendFlag).not.toHaveBeenCalled()
  })

  it('throws when sendFlag reports failure so the queue retries', async () => {
    vi.mocked(sendFlag).mockResolvedValue({ ok: false, uri: 'flag-uri' })
    const database = createDatabase()

    await expect(
      runJob(database, {
        reportId: 'report-1',
        targetActorId: TARGET,
        statusIds: [],
        content: ''
      })
    ).rejects.toThrow('Failed to send Flag')
  })
})
