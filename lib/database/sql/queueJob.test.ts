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

      // Replay the failed job with explicit replay and claim again
      await database.replayQueueJob({ id: 'fail-dlq-dup-1' })

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

    it('preserves existing job error and stack when error is omitted', async () => {
      await database.createQueueJob({
        id: 'fail-dlq-no-err-1',
        name: 'deliverActivity',
        payload: samplePayload
      })

      const claim1 = await database.claimQueueJob({ id: 'fail-dlq-no-err-1' })
      expect(claim1).not.toBeNull()

      // Schedule retry with an error to store error info on the row
      await database.scheduleQueueJobRetry({
        id: 'fail-dlq-no-err-1',
        claimToken: claim1!.claimToken,
        nextRunAt: new Date(Date.now() - 1000),
        attempts: 15,
        error: new Error('Prior retry failure message')
      })

      // Reclaim for final attempt
      const claim2 = await database.claimQueueJob({ id: 'fail-dlq-no-err-1' })
      expect(claim2).not.toBeNull()

      // Terminal failure without passing error explicitly
      const success = await database.failQueueJobWithDeadLetter({
        id: 'fail-dlq-no-err-1',
        claimToken: claim2!.claimToken,
        attempts: 16
      })

      expect(success).toBe(true)

      const queueJob = await database.getQueueJobById('fail-dlq-no-err-1')
      expect(queueJob?.lastErrorMessage).toBe('Prior retry failure message')
      expect(queueJob?.lastErrorStack).toBeDefined()

      const dlq = await database.getDeadLetterJobById('fail-dlq-no-err-1')
      expect(dlq?.errorMessage).toBe('Prior retry failure message')
      expect(dlq?.errorStack).toBeDefined()
    })

    it('safely handles corrupt non-JSON payload in queue_jobs without throwing', async () => {
      await database.createQueueJob({
        id: 'fail-dlq-corrupt-1',
        name: 'deliverActivity',
        payload: samplePayload
      })

      const claim = await database.claimQueueJob({ id: 'fail-dlq-corrupt-1' })
      expect(claim).not.toBeNull()

      // Corrupt the payload directly in the database after claim
      await knexDatabase('queue_jobs')
        .where({ id: 'fail-dlq-corrupt-1' })
        .update({ payload: 'corrupt-non-json-payload{{{' })

      const success = await database.failQueueJobWithDeadLetter({
        id: 'fail-dlq-corrupt-1',
        claimToken: claim!.claimToken,
        attempts: 16,
        error: new Error('Corrupt job terminal error')
      })

      expect(success).toBe(true)

      const dlq = await database.getDeadLetterJobById('fail-dlq-corrupt-1')
      expect(dlq).not.toBeNull()
      expect(dlq?.payload).toEqual({ raw: 'corrupt-non-json-payload{{{' })
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

  it('preserves payload, attempts, schedule, state, and claim token on duplicate enqueue across all states', async () => {
    // 1. Pending state
    const originalPending = await database.createQueueJob({
      id: 'dup-pending-1',
      name: 'deliverActivity',
      payload: {
        id: 'dup-pending-1',
        name: 'deliverActivity',
        data: { version: 1 }
      },
      attempts: 2,
      maxRetries: 10,
      nextRunAt: new Date(Date.now() + 50000),
      status: 'pending'
    })

    const duplicatePending = await database.createQueueJob({
      id: 'dup-pending-1',
      name: 'deliverActivityOverwritten',
      payload: {
        id: 'dup-pending-1',
        name: 'deliverActivityOverwritten',
        data: { version: 2 }
      },
      attempts: 0,
      maxRetries: 5,
      nextRunAt: new Date(Date.now() + 100000),
      status: 'failed'
    })

    expect(duplicatePending.payload).toEqual(originalPending.payload)
    expect(duplicatePending.attempts).toBe(originalPending.attempts)
    expect(duplicatePending.maxRetries).toBe(originalPending.maxRetries)
    expect(duplicatePending.nextRunAt).toBe(originalPending.nextRunAt)
    expect(duplicatePending.status).toBe('pending')

    // 2. Processing state (with claimToken)
    await database.createQueueJob({
      id: 'dup-processing-1',
      name: 'deliverActivity',
      payload: samplePayload
    })
    const claimed = await database.claimQueueJob({ id: 'dup-processing-1' })
    expect(claimed).not.toBeNull()
    expect(claimed?.claimToken).toBeDefined()

    const duplicateProcessing = await database.createQueueJob({
      id: 'dup-processing-1',
      name: 'deliverActivityOverwritten',
      payload: { ...samplePayload, data: { overwritten: true } },
      attempts: 0,
      status: 'pending'
    })

    expect(duplicateProcessing.status).toBe('processing')
    expect(duplicateProcessing.claimToken).toBe(claimed?.claimToken)
    expect(duplicateProcessing.payload).toEqual(samplePayload)

    // 3. Completed state
    await database.completeQueueJob({
      id: 'dup-processing-1',
      claimToken: claimed!.claimToken
    })
    const duplicateCompleted = await database.createQueueJob({
      id: 'dup-processing-1',
      name: 'deliverActivityOverwritten',
      payload: { ...samplePayload, data: { overwritten: true } },
      status: 'pending'
    })
    expect(duplicateCompleted.status).toBe('completed')
    expect(duplicateCompleted.claimToken).toBeNull()

    // 4. Failed state
    await database.createQueueJob({
      id: 'dup-failed-1',
      name: 'deliverActivity',
      payload: samplePayload
    })
    const claimedFailed = await database.claimQueueJob({ id: 'dup-failed-1' })
    await database.failQueueJob({
      id: 'dup-failed-1',
      claimToken: claimedFailed!.claimToken,
      attempts: 16,
      error: new Error('Original terminal failure')
    })
    const duplicateFailed = await database.createQueueJob({
      id: 'dup-failed-1',
      name: 'deliverActivityOverwritten',
      payload: { ...samplePayload, data: { overwritten: true } },
      attempts: 0,
      status: 'pending'
    })
    expect(duplicateFailed.status).toBe('failed')
    expect(duplicateFailed.attempts).toBe(16)
    expect(duplicateFailed.lastErrorMessage).toBe('Original terminal failure')
  })

  it('explicitly replays failed database jobs transactionally, resetting attempts, errors, and claim ownership', async () => {
    const jobPayload: JobMessage = {
      id: 'replay-test-1',
      name: 'deliverActivity',
      data: { replay: true }
    }

    await database.createQueueJob({
      id: 'replay-test-1',
      name: 'deliverActivity',
      payload: jobPayload
    })
    const claimed = await database.claimQueueJob({ id: 'replay-test-1' })
    expect(claimed).not.toBeNull()

    await database.failQueueJobWithDeadLetter({
      id: 'replay-test-1',
      claimToken: claimed!.claimToken,
      attempts: 16,
      error: new Error('Terminal crash')
    })

    const failedJob = await database.getQueueJobById('replay-test-1')
    expect(failedJob?.status).toBe('failed')
    expect(failedJob?.attempts).toBe(16)
    expect(failedJob?.lastErrorMessage).toBe('Terminal crash')

    const dlqJob = await knexDatabase('dead_letter_jobs')
      .where({ id: 'replay-test-1' })
      .first()
    expect(dlqJob?.status).toBe('failed')

    // Replay job
    const success = await database.replayQueueJob({ id: 'replay-test-1' })
    expect(success).toBe(true)

    const replayedJob = await database.getQueueJobById('replay-test-1')
    expect(replayedJob?.status).toBe('pending')
    expect(replayedJob?.attempts).toBe(0)
    expect(replayedJob?.claimToken).toBeNull()
    expect(replayedJob?.lastErrorMessage).toBeNull()
    expect(replayedJob?.lastErrorStack).toBeNull()

    const replayedDlq = await knexDatabase('dead_letter_jobs')
      .where({ id: 'replay-test-1' })
      .first()
    expect(replayedDlq?.status).toBe('retried')
  })

  it('rolls back DLQ status update if queue job replay fails', async () => {
    // Insert a dead letter job without a corresponding queue_jobs row
    await knexDatabase('dead_letter_jobs').insert({
      id: 'missing-queue-job-1',
      job_name: 'deliverActivity',
      payload: JSON.stringify(samplePayload),
      error_message: 'Some error',
      attempts: 16,
      status: 'failed',
      created_at: new Date(),
      updated_at: new Date()
    })

    const success = await database.replayQueueJob({ id: 'missing-queue-job-1' })
    expect(success).toBe(false)

    // Verify DLQ status was NOT changed to retried because transaction rolled back
    const dlqRecord = await knexDatabase('dead_letter_jobs')
      .where({ id: 'missing-queue-job-1' })
      .first()
    expect(dlqRecord?.status).toBe('failed')
  })

  it('handles concurrent replay safely so only one replay commits', async () => {
    await database.createQueueJob({
      id: 'concurrent-replay-1',
      name: 'deliverActivity',
      payload: samplePayload
    })
    const claimed = await database.claimQueueJob({ id: 'concurrent-replay-1' })
    await database.failQueueJobWithDeadLetter({
      id: 'concurrent-replay-1',
      claimToken: claimed!.claimToken,
      attempts: 16,
      error: new Error('Fail once')
    })

    const results = await Promise.all([
      database.replayQueueJob({ id: 'concurrent-replay-1' }),
      database.replayQueueJob({ id: 'concurrent-replay-1' })
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
    expect(results.filter((r) => !r)).toHaveLength(1)

    const job = await database.getQueueJobById('concurrent-replay-1')
    expect(job?.status).toBe('pending')
    expect(job?.attempts).toBe(0)

    const dlqRecord = await knexDatabase('dead_letter_jobs')
      .where({ id: 'concurrent-replay-1' })
      .first()
    expect(dlqRecord?.status).toBe('retried')
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
