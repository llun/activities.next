import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { JobMessage } from '@/lib/services/queue/type'

describe('QueueJobDatabase', () => {
  const {
    database,
    instance: knexDatabase,
    prepare
  } = getTestDatabaseWithInstance(true)

  beforeAll(async () => {
    await prepare()
    await database.migrate()
  }, 30000)

  afterAll(async () => {
    await database.destroy()
  })

  const samplePayload: JobMessage = {
    id: 'job-123',
    name: 'deliverActivity',
    data: { inbox: 'https://example.com/inbox', activity: { type: 'Create' } }
  }

  it('creates queue jobs and retrieves by id with null claimToken', async () => {
    const job = await database.createQueueJob({
      id: 'custom-id-1',
      name: 'deliverActivity',
      payload: samplePayload,
      attempts: 0,
      maxRetries: 16
    })

    expect(job.id).toBe('custom-id-1')
    expect(job.name).toBe('deliverActivity')
    expect(job.status).toBe('pending')
    expect(job.attempts).toBe(0)
    expect(job.maxRetries).toBe(16)
    expect(job.payload).toEqual(samplePayload)
    expect(job.claimToken).toBeNull()
    expect(job.createdAt).toBeTypeOf('number')
    expect(job.nextRunAt).toBeTypeOf('number')

    const fetched = await database.getQueueJobById('custom-id-1')
    expect(fetched).toEqual(job)
  })

  it('returns due jobs filtered by next_run_at and status', async () => {
    const now = Date.now()

    // Due job (past)
    await database.createQueueJob({
      id: 'due-1',
      name: 'deliverActivity',
      payload: samplePayload,
      nextRunAt: new Date(now - 10000)
    })

    // Future job (not due yet)
    await database.createQueueJob({
      id: 'future-1',
      name: 'deliverActivity',
      payload: samplePayload,
      nextRunAt: new Date(now + 60000)
    })

    const dueJobs = await database.getDueQueueJobs({
      now: new Date(now)
    })
    const ids = dueJobs.map((j) => j.id)

    expect(ids).toContain('due-1')
    expect(ids).not.toContain('future-1')
  })

  it('atomically claims a pending job with claimToken, preventing duplicate processing', async () => {
    await database.createQueueJob({
      id: 'claimable-1',
      name: 'deliverActivity',
      payload: samplePayload
    })

    const firstClaim = await database.claimQueueJob({ id: 'claimable-1' })
    expect(firstClaim).not.toBeNull()
    expect(firstClaim?.id).toBe('claimable-1')
    expect(firstClaim?.status).toBe('processing')
    expect(firstClaim?.claimToken).toBeTypeOf('string')
    expect(firstClaim?.claimToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    )

    // Second claim must fail because status is now processing
    const secondClaim = await database.claimQueueJob({ id: 'claimable-1' })
    expect(secondClaim).toBeNull()

    const job = await database.getQueueJobById('claimable-1')
    expect(job?.status).toBe('processing')
    expect(job?.claimToken).toBe(firstClaim?.claimToken)
  })

  it('handles competing claims concurrently: exactly one worker succeeds', async () => {
    await database.createQueueJob({
      id: 'competing-claim-1',
      name: 'deliverActivity',
      payload: samplePayload
    })

    const claimAttempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        database.claimQueueJob({ id: 'competing-claim-1' })
      )
    )

    const successfulClaims = claimAttempts.filter(
      (result) => result !== null && result !== undefined
    )
    const failedClaims = claimAttempts.filter((result) => result === null)

    expect(successfulClaims.length).toBe(1)
    expect(failedClaims.length).toBe(7)
    expect(successfulClaims[0]?.claimToken).toBeTypeOf('string')
  })

  it('rejects claim when a job was rescheduled between discovery and claim', async () => {
    const now = Date.now()

    await database.createQueueJob({
      id: 'rescheduled-between-discovery-1',
      name: 'deliverActivity',
      payload: samplePayload,
      nextRunAt: new Date(now - 5000)
    })

    // Discovered as due at `now`
    const dueJobs = await database.getDueQueueJobs({ now: new Date(now) })
    expect(
      dueJobs.some((j) => j.id === 'rescheduled-between-discovery-1')
    ).toBe(true)

    // Job was rescheduled to future before claim executes
    await knexDatabase('queue_jobs')
      .where({ id: 'rescheduled-between-discovery-1' })
      .update({
        next_run_at: new Date(now + 60000)
      })

    // Claim attempted at `now` must fail because next_run_at > now
    const claim = await database.claimQueueJob({
      id: 'rescheduled-between-discovery-1',
      now: new Date(now)
    })
    expect(claim).toBeNull()

    const job = await database.getQueueJobById(
      'rescheduled-between-discovery-1'
    )
    expect(job?.status).toBe('pending')
  })

  it('completes a job with valid claimToken and rejects invalid or stale claimToken', async () => {
    await database.createQueueJob({
      id: 'completable-1',
      name: 'deliverActivity',
      payload: samplePayload
    })

    const claim = await database.claimQueueJob({ id: 'completable-1' })
    expect(claim).not.toBeNull()

    // Wrong token fails
    const invalidTokenComplete = await database.completeQueueJob({
      id: 'completable-1',
      claimToken: 'wrong-token-uuid'
    })
    expect(invalidTokenComplete).toBe(false)

    // Valid token succeeds
    const completed = await database.completeQueueJob({
      id: 'completable-1',
      claimToken: claim!.claimToken
    })
    expect(completed).toBe(true)

    const job = await database.getQueueJobById('completable-1')
    expect(job?.status).toBe('completed')
    expect(job?.claimToken).toBeNull()

    // Second completion with same token is rejected (status no longer processing)
    const secondComplete = await database.completeQueueJob({
      id: 'completable-1',
      claimToken: claim!.claimToken
    })
    expect(secondComplete).toBe(false)
  })

  it('schedules retry with valid claimToken and rejects invalid or stale claimToken', async () => {
    await database.createQueueJob({
      id: 'retryable-1',
      name: 'deliverActivity',
      payload: samplePayload
    })

    const claim = await database.claimQueueJob({ id: 'retryable-1' })
    expect(claim).not.toBeNull()

    const nextRun = new Date(Date.now() + 5000)
    const err = new Error('Simulated network timeout')

    // Wrong token fails
    const invalidTokenRetry = await database.scheduleQueueJobRetry({
      id: 'retryable-1',
      claimToken: 'wrong-token-uuid',
      nextRunAt: nextRun,
      attempts: 1,
      error: err
    })
    expect(invalidTokenRetry).toBe(false)

    // Valid token succeeds
    const scheduled = await database.scheduleQueueJobRetry({
      id: 'retryable-1',
      claimToken: claim!.claimToken,
      nextRunAt: nextRun,
      attempts: 1,
      error: err
    })
    expect(scheduled).toBe(true)

    const job = await database.getQueueJobById('retryable-1')
    expect(job?.status).toBe('pending')
    expect(job?.attempts).toBe(1)
    expect(job?.claimToken).toBeNull()
    expect(job?.lastErrorMessage).toBe('Simulated network timeout')
    expect(job?.lastErrorStack).toContain('Error: Simulated network timeout')

    // Second retry with same token is rejected (status no longer processing)
    const secondRetry = await database.scheduleQueueJobRetry({
      id: 'retryable-1',
      claimToken: claim!.claimToken,
      nextRunAt: nextRun,
      attempts: 2,
      error: err
    })
    expect(secondRetry).toBe(false)
  })

  it('fails a job terminally with valid claimToken and rejects invalid or stale claimToken', async () => {
    await database.createQueueJob({
      id: 'failable-1',
      name: 'deliverActivity',
      payload: samplePayload
    })

    const claim = await database.claimQueueJob({ id: 'failable-1' })
    expect(claim).not.toBeNull()

    const err = new Error('Permanent 410 Gone')

    // Wrong token fails
    const invalidTokenFail = await database.failQueueJob({
      id: 'failable-1',
      claimToken: 'wrong-token-uuid',
      attempts: 16,
      error: err
    })
    expect(invalidTokenFail).toBe(false)

    // Valid token succeeds
    const failed = await database.failQueueJob({
      id: 'failable-1',
      claimToken: claim!.claimToken,
      attempts: 16,
      error: err
    })
    expect(failed).toBe(true)

    const job = await database.getQueueJobById('failable-1')
    expect(job?.status).toBe('failed')
    expect(job?.attempts).toBe(16)
    expect(job?.claimToken).toBeNull()
    expect(job?.lastErrorMessage).toBe('Permanent 410 Gone')

    // Second fail with same token is rejected
    const secondFail = await database.failQueueJob({
      id: 'failable-1',
      claimToken: claim!.claimToken,
      attempts: 17,
      error: err
    })
    expect(secondFail).toBe(false)
  })

  describe('failQueueJobWithDeadLetter', () => {
    it('verifies claim ownership, marks job failed, and writes dead-letter record', async () => {
      await database.createQueueJob({
        id: 'fail-dlq-1',
        name: 'deliverActivity',
        payload: samplePayload,
        attempts: 15
      })

      const claim = await database.claimQueueJob({ id: 'fail-dlq-1' })
      expect(claim).not.toBeNull()

      const err = new Error('Terminal upstream rejection')
      const success = await database.failQueueJobWithDeadLetter({
        id: 'fail-dlq-1',
        claimToken: claim!.claimToken,
        attempts: 16,
        error: err
      })

      expect(success).toBe(true)

      // Verify queue_jobs state
      const queueJob = await database.getQueueJobById('fail-dlq-1')
      expect(queueJob?.status).toBe('failed')
      expect(queueJob?.attempts).toBe(16)
      expect(queueJob?.claimToken).toBeNull()
      expect(queueJob?.lastErrorMessage).toBe('Terminal upstream rejection')
      expect(queueJob?.lastErrorStack).toBe(err.stack)

      // Verify dead_letter_jobs state derived from owned row
      const dlqJob = await database.getDeadLetterJobById('fail-dlq-1')
      expect(dlqJob).not.toBeNull()
      expect(dlqJob?.id).toBe('fail-dlq-1')
      expect(dlqJob?.jobName).toBe('deliverActivity')
      expect(dlqJob?.payload).toEqual(samplePayload)
      expect(dlqJob?.errorMessage).toBe('Terminal upstream rejection')
      expect(dlqJob?.errorStack).toBe(err.stack)
      expect(dlqJob?.attempts).toBe(16)
      expect(dlqJob?.status).toBe('failed')
    })

    it('handles non-Error error cleanly preserving string representation', async () => {
      await database.createQueueJob({
        id: 'fail-dlq-str-err',
        name: 'deliverActivity',
        payload: samplePayload
      })

      const claim = await database.claimQueueJob({ id: 'fail-dlq-str-err' })
      expect(claim).not.toBeNull()

      const success = await database.failQueueJobWithDeadLetter({
        id: 'fail-dlq-str-err',
        claimToken: claim!.claimToken,
        attempts: 5,
        error: 'raw-string-error'
      })

      expect(success).toBe(true)

      const queueJob = await database.getQueueJobById('fail-dlq-str-err')
      expect(queueJob?.lastErrorMessage).toBe('raw-string-error')
      expect(queueJob?.lastErrorStack).toBeNull()

      const dlqJob = await database.getDeadLetterJobById('fail-dlq-str-err')
      expect(dlqJob?.errorMessage).toBe('raw-string-error')
      expect(dlqJob?.errorStack).toBeNull()
    })

    it('rejects stale claim token and changes neither queue_jobs nor dead_letter_jobs', async () => {
      await database.createQueueJob({
        id: 'fail-dlq-stale-1',
        name: 'deliverActivity',
        payload: samplePayload
      })

      const claim = await database.claimQueueJob({ id: 'fail-dlq-stale-1' })
      expect(claim).not.toBeNull()

      const success = await database.failQueueJobWithDeadLetter({
        id: 'fail-dlq-stale-1',
        claimToken: 'stale-claim-token-uuid',
        attempts: 16,
        error: new Error('stale failure')
      })

      expect(success).toBe(false)

      // queue_jobs must be unchanged
      const queueJob = await database.getQueueJobById('fail-dlq-stale-1')
      expect(queueJob?.status).toBe('processing')
      expect(queueJob?.claimToken).toBe(claim?.claimToken)

      // dead_letter_jobs must have no record
      const dlqJob = await database.getDeadLetterJobById('fail-dlq-stale-1')
      expect(dlqJob).toBeNull()
    })

    it('updates existing dead-letter record on duplicate terminal delivery', async () => {
      // Create initial job and fail it
      await database.createQueueJob({
        id: 'fail-dlq-dup-1',
        name: 'deliverActivity',
        payload: samplePayload
      })

      const claim1 = await database.claimQueueJob({ id: 'fail-dlq-dup-1' })
      expect(claim1).not.toBeNull()

      await database.failQueueJobWithDeadLetter({
        id: 'fail-dlq-dup-1',
        claimToken: claim1!.claimToken,
        attempts: 1,
        error: new Error('First failure')
      })

      const initialDlq = await database.getDeadLetterJobById('fail-dlq-dup-1')
      expect(initialDlq?.errorMessage).toBe('First failure')
      expect(initialDlq?.attempts).toBe(1)

      // Re-enqueue with the same ID and claim again
      await database.createQueueJob({
        id: 'fail-dlq-dup-1',
        name: 'deliverActivity',
        payload: samplePayload,
        status: 'pending'
      })

      const claim2 = await database.claimQueueJob({ id: 'fail-dlq-dup-1' })
      expect(claim2).not.toBeNull()

      // Second terminal failure with same ID updates DLQ record
      const success2 = await database.failQueueJobWithDeadLetter({
        id: 'fail-dlq-dup-1',
        claimToken: claim2!.claimToken,
        attempts: 5,
        error: new Error('Second updated failure')
      })

      expect(success2).toBe(true)

      const updatedDlq = await database.getDeadLetterJobById('fail-dlq-dup-1')
      expect(updatedDlq?.errorMessage).toBe('Second updated failure')
      expect(updatedDlq?.attempts).toBe(5)
    })

    it('rolls back queue_jobs update if dead_letter_jobs write fails', async () => {
      await database.createQueueJob({
        id: 'fail-dlq-rollback-1',
        name: 'deliverActivity',
        payload: samplePayload
      })

      const claim = await database.claimQueueJob({ id: 'fail-dlq-rollback-1' })
      expect(claim).not.toBeNull()

      // Temporarily rename dead_letter_jobs table to force dead letter write failure
      await knexDatabase.schema.renameTable(
        'dead_letter_jobs',
        'dead_letter_jobs_bak'
      )

      try {
        await expect(
          database.failQueueJobWithDeadLetter({
            id: 'fail-dlq-rollback-1',
            claimToken: claim!.claimToken,
            attempts: 16,
            error: new Error('Transaction rollback test error')
          })
        ).rejects.toThrow()

        // Transaction must have rolled back: queue_jobs is STILL in 'processing' with original claimToken
        const queueJob = await database.getQueueJobById('fail-dlq-rollback-1')
        expect(queueJob?.status).toBe('processing')
        expect(queueJob?.claimToken).toBe(claim!.claimToken)
      } finally {
        await knexDatabase.schema.renameTable(
          'dead_letter_jobs_bak',
          'dead_letter_jobs'
        )
      }
    })
  })

  it('reclaims stalled processing job with fresh claimToken and rejects stale worker settlement', async () => {
    const now = Date.now()

    await database.createQueueJob({
      id: 'stalled-reclaim-1',
      name: 'deliverActivity',
      payload: samplePayload
    })

    // Worker 1 claims
    const claim1 = await database.claimQueueJob({ id: 'stalled-reclaim-1' })
    expect(claim1).not.toBeNull()

    // Worker 1 crashes / stalls; backdate updated_at by 20 minutes
    await knexDatabase('queue_jobs')
      .where({ id: 'stalled-reclaim-1' })
      .update({
        status: 'processing',
        updated_at: new Date(now - 20 * 60 * 1000)
      })

    // Worker 2 reclaims after 15 min stalled timeout
    const stalledBefore = new Date(now - 15 * 60 * 1000)
    const claim2 = await database.claimQueueJob({
      id: 'stalled-reclaim-1',
      now: new Date(now),
      stalledBefore
    })
    expect(claim2).not.toBeNull()
    expect(claim2?.claimToken).not.toEqual(claim1?.claimToken)

    // Stale Worker 1 wakes up and tries to complete: rejected
    const worker1Complete = await database.completeQueueJob({
      id: 'stalled-reclaim-1',
      claimToken: claim1!.claimToken
    })
    expect(worker1Complete).toBe(false)

    // Active Worker 2 completes: accepted
    const worker2Complete = await database.completeQueueJob({
      id: 'stalled-reclaim-1',
      claimToken: claim2!.claimToken
    })
    expect(worker2Complete).toBe(true)

    const job = await database.getQueueJobById('stalled-reclaim-1')
    expect(job?.status).toBe('completed')
  })

  it('counts and deletes jobs', async () => {
    const pendingBefore = await database.countQueueJobs({ status: 'pending' })
    expect(pendingBefore).toBeGreaterThan(0)

    const deleted = await database.deleteQueueJob('custom-id-1')
    expect(deleted).toBe(true)

    const notFound = await database.getQueueJobById('custom-id-1')
    expect(notFound).toBeNull()
  })

  it('re-enqueues or upserts an existing job on duplicate id without primary key collision', async () => {
    // Create a job that eventually failed
    await database.createQueueJob({
      id: 'retry-upsert-1',
      name: 'deliverActivity',
      payload: samplePayload,
      attempts: 16,
      status: 'failed',
      lastErrorMessage: 'Original terminal failure'
    })

    const failedJob = await database.getQueueJobById('retry-upsert-1')
    expect(failedJob?.status).toBe('failed')
    expect(failedJob?.attempts).toBe(16)

    // Re-enqueue with the same ID (e.g. from DLQ retry)
    const reEnqueued = await database.createQueueJob({
      id: 'retry-upsert-1',
      name: 'deliverActivity',
      payload: samplePayload,
      attempts: 0,
      status: 'pending'
    })

    expect(reEnqueued.id).toBe('retry-upsert-1')
    expect(reEnqueued.status).toBe('pending')
    expect(reEnqueued.attempts).toBe(0)
    expect(reEnqueued.claimToken).toBeNull()

    const fetched = await database.getQueueJobById('retry-upsert-1')
    expect(fetched?.status).toBe('pending')
    expect(fetched?.attempts).toBe(0)
    expect(fetched?.claimToken).toBeNull()
  })

  it('recovers stalled processing jobs when stalledTimeoutMs is passed', async () => {
    const now = Date.now()

    // Create a job stuck in 'processing' since 30 minutes ago
    await database.createQueueJob({
      id: 'stalled-1',
      name: 'deliverActivity',
      payload: samplePayload,
      status: 'processing'
    })

    // Manually backdate updated_at to simulate a crashed worker
    await knexDatabase('queue_jobs')
      .where({ id: 'stalled-1' })
      .update({
        status: 'processing',
        updated_at: new Date(now - 30 * 60 * 1000)
      })

    // Without stalled timeout, getDueQueueJobs ignores it
    const normalDue = await database.getDueQueueJobs({
      now: new Date(now),
      stalledTimeoutMs: 0
    })
    expect(normalDue.some((j) => j.id === 'stalled-1')).toBe(false)

    // With stalled timeout (15 min), it is returned
    const recoveredDue = await database.getDueQueueJobs({
      now: new Date(now),
      stalledTimeoutMs: 15 * 60 * 1000
    })
    expect(recoveredDue.some((j) => j.id === 'stalled-1')).toBe(true)

    // And can be claimed by passing stalledBefore
    const claimed = await database.claimQueueJob({
      id: 'stalled-1',
      now: new Date(now),
      stalledBefore: new Date(now - 15 * 60 * 1000)
    })
    expect(claimed).not.toBeNull()
    expect(claimed?.id).toBe('stalled-1')
    expect(claimed?.claimToken).toBeDefined()
  })
})
