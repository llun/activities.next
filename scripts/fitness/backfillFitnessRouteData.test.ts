import { getDatabase } from '@/lib/database'
import { getFitnessFileBuffer } from '@/lib/services/fitness-files'
import {
  hasPreParsedRouteData,
  savePreParsedRouteData
} from '@/lib/services/fitness-files/fileRouteDataCache'
import { parseFitnessFile } from '@/lib/services/fitness-files/parseFitnessFile'

import {
  backfillFitnessRouteDataScript,
  parseArgs
} from './backfillFitnessRouteData'

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn()
}))

vi.mock('@/lib/services/fitness-files', () => ({
  getFitnessFileBuffer: vi.fn()
}))

vi.mock('@/lib/services/fitness-files/fileRouteDataCache', () => ({
  hasPreParsedRouteData: vi.fn(),
  savePreParsedRouteData: vi.fn()
}))

vi.mock('@/lib/services/fitness-files/parseFitnessFile', () => ({
  isParseableFitnessFileType: vi.fn().mockReturnValue(true),
  parseFitnessFile: vi.fn()
}))

vi.mock('./describeConnection', () => ({
  printDatabaseBanner: vi.fn()
}))

describe('backfillFitnessRouteData parseArgs', () => {
  it('parses actor-id, force, and dry-run flags', () => {
    const args = [
      '--actor-id',
      'https://llun.test/users/test',
      '--force',
      '--dry-run'
    ]
    expect(parseArgs(args)).toEqual({
      actorId: 'https://llun.test/users/test',
      force: true,
      dryRun: true
    })
  })

  it('supports inline values', () => {
    const args = [
      '--actor-id=https://llun.test/users/test',
      '--force=false',
      '--dry-run=true'
    ]
    expect(parseArgs(args)).toEqual({
      actorId: 'https://llun.test/users/test',
      force: false,
      dryRun: true
    })
  })

  it('throws when actor-id is missing', () => {
    const args = ['--dry-run']
    expect(() => parseArgs(args)).toThrow()
  })

  it('throws on unknown arguments or missing values', () => {
    expect(() => parseArgs(['unknown'])).toThrow('Unexpected argument')
    expect(() => parseArgs(['--actor-id'])).toThrow(
      'Missing value for --actor-id'
    )
    expect(() => parseArgs(['--dry-run=invalid'])).toThrow(
      'Invalid boolean value'
    )
  })
})

describe('backfillFitnessRouteDataScript', () => {
  it('uses hasPreParsedRouteData so outdated-version rows are backfilled without --force', async () => {
    const mockDestroy = vi.fn()
    vi.mocked(getDatabase).mockReturnValue({
      getActorFromId: vi
        .fn()
        .mockResolvedValue({ id: 'https://llun.test/users/test' }),
      getFitnessFilesByActor: vi.fn().mockResolvedValueOnce([
        {
          id: 'file-stale',
          actorId: 'https://llun.test/users/test',
          fileName: 'stale.fit',
          fileType: 'fit',
          processingStatus: 'completed'
        },
        {
          id: 'file-valid',
          actorId: 'https://llun.test/users/test',
          fileName: 'valid.fit',
          fileType: 'fit',
          processingStatus: 'completed'
        }
      ]),
      destroy: mockDestroy
    } as never)

    vi.mocked(hasPreParsedRouteData)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)

    vi.mocked(getFitnessFileBuffer).mockResolvedValue(Buffer.from('fit'))
    vi.mocked(parseFitnessFile).mockResolvedValue({
      coordinates: [],
      trackPoints: [],
      totalDistanceMeters: 1000,
      totalDurationSeconds: 100
    })

    const exitCode = await backfillFitnessRouteDataScript([
      '--actor-id',
      'https://llun.test/users/test'
    ])

    expect(exitCode).toBe(0)
    expect(hasPreParsedRouteData).toHaveBeenCalledTimes(2)
    expect(savePreParsedRouteData).toHaveBeenCalledTimes(1)
    expect(savePreParsedRouteData).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        fitnessFileId: 'file-stale',
        actorId: 'https://llun.test/users/test'
      })
    )
    expect(mockDestroy).toHaveBeenCalled()
  })
})
