import { Database } from '@/lib/database/types'
import { createAnnounceJob } from '@/lib/jobs/createAnnounceJob'
import { createNoteJob } from '@/lib/jobs/createNoteJob'
import { createPollJob } from '@/lib/jobs/createPollJob'
import { createPollVoteJob } from '@/lib/jobs/createPollVoteJob'
import {
  CREATE_ANNOUNCE_JOB_NAME,
  CREATE_NOTE_JOB_NAME,
  CREATE_POLL_JOB_NAME,
  CREATE_POLL_VOTE_JOB_NAME,
  UPDATE_NOTE_JOB_NAME,
  UPDATE_POLL_JOB_NAME
} from '@/lib/jobs/names'
import { updateNoteJob } from '@/lib/jobs/updateNoteJob'
import { updatePollJob } from '@/lib/jobs/updatePollJob'
import { JobHandle } from '@/lib/services/queue/type'
import { logger } from '@/lib/utils/logger'

// vi.mock factories are hoisted, so the mock fn is created INSIDE the factory
// and read back through the imported binding rather than referenced from an
// outer const (which would not be initialised when the factory runs).
vi.mock('@/lib/utils/logger', () => {
  const mockLogger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => mockLogger)
  }
  return {
    logger: mockLogger,
    levelToSeverity: {},
    getLoggerOptions: () => ({})
  }
})

// A malformed payload returns before any database access, so the jobs never
// touch this stub.
const database = {} as unknown as Database
const PAYLOAD_ID = 'https://malformed.test/object/1'

const cases: {
  description: string
  run: JobHandle
  job: string
  message: string
  idKey: string
}[] = [
  {
    description: 'createNoteJob',
    run: createNoteJob,
    job: CREATE_NOTE_JOB_NAME,
    message: 'Dropping malformed note payload',
    idKey: 'statusId'
  },
  {
    description: 'createPollJob',
    run: createPollJob,
    job: CREATE_POLL_JOB_NAME,
    message: 'Dropping malformed poll payload',
    idKey: 'statusId'
  },
  {
    description: 'updateNoteJob',
    run: updateNoteJob,
    job: UPDATE_NOTE_JOB_NAME,
    message: 'Dropping malformed note update payload',
    idKey: 'statusId'
  },
  {
    description: 'updatePollJob',
    run: updatePollJob,
    job: UPDATE_POLL_JOB_NAME,
    message: 'Dropping malformed poll update payload',
    idKey: 'statusId'
  },
  {
    description: 'createAnnounceJob',
    run: createAnnounceJob,
    job: CREATE_ANNOUNCE_JOB_NAME,
    message: 'Dropping malformed announce payload',
    idKey: 'announceId'
  },
  {
    description: 'createPollVoteJob',
    run: createPollVoteJob,
    job: CREATE_POLL_VOTE_JOB_NAME,
    message: 'Dropping malformed poll vote payload',
    idKey: 'statusId'
  }
]

describe('dropping a malformed federated payload logs a warning', () => {
  beforeEach(() => {
    // A vi.fn() created inside a vi.mock factory is not reset by
    // vi.restoreAllMocks(), so clear it explicitly between cases.
    vi.mocked(logger.warn).mockReset()
  })

  it.each(cases)(
    '$description warns with the job name and payload id',
    async ({ run, job, message, idKey }) => {
      await run(database, {
        id: 'malformed',
        name: job,
        data: { id: PAYLOAD_ID, invalid: true }
      })

      expect(vi.mocked(logger.warn)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        expect.objectContaining({
          message,
          job,
          [idKey]: PAYLOAD_ID
        })
      )
    }
  )
})
