import path from 'path'

import { logger } from '@/lib/utils/logger'

import { assertStorageFilePath, resolveStorageFilePath } from './storagePath'

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

beforeEach(() => {
  vi.clearAllMocks()
})

const STORAGE_ROOT = '/srv/activities/uploads'

describe('resolveStorageFilePath', () => {
  it.each([
    {
      description: 'a plain file name',
      filePath: 'avatar.webp',
      expected: `${STORAGE_ROOT}/avatar.webp`
    },
    {
      description: 'a nested file name',
      filePath: '2026-08-26/ride.fit',
      expected: `${STORAGE_ROOT}/2026-08-26/ride.fit`
    },
    {
      description: 'an inner traversal',
      filePath: 'nested/../avatar.webp',
      expected: `${STORAGE_ROOT}/avatar.webp`
    },
    {
      description: 'the root itself',
      filePath: '',
      expected: STORAGE_ROOT
    }
  ])('resolves $description', ({ filePath, expected }) => {
    expect(resolveStorageFilePath(STORAGE_ROOT, filePath)).toBe(expected)
  })

  it.each([
    { description: 'a leading traversal', filePath: '../secret.webp' },
    {
      description: 'a traversal past an inner directory',
      filePath: 'nested/../../secret.webp'
    },
    { description: 'an absolute path', filePath: '/etc/passwd' },
    {
      description: 'a sibling directory of the root',
      filePath: '../uploads-backup/secret.webp'
    }
  ])('refuses $description', ({ filePath }) => {
    expect(resolveStorageFilePath(STORAGE_ROOT, filePath)).toBeNull()
  })

  // A characterization test, not a bug report. The comparison is
  // case-SENSITIVE, so on a case-insensitive filesystem — macOS, Windows — an
  // absolute path naming a file genuinely inside the root is refused when it
  // differs from the root only in letter case.
  //
  // The direction is deliberate: what this costs is a spurious refusal — a read
  // shaped like a 404, or a delete that quietly did nothing — and never a missed
  // traversal. Folding case here would do the opposite on a case-SENSITIVE
  // filesystem, where `/SRV/...` and `/srv/...` are two genuinely different
  // directories and accepting one for the other is exactly the escape this
  // module exists to refuse. `scripts/maintenance/cleanupMediaStorage.ts`'s
  // `getContainedRelativePath` goes the other way — realpath plus a
  // segment-wise case-insensitive compare — because for a tool that DELETES
  // files the trade is inverted, and concluding "unrelated" is the expensive
  // answer to get wrong.
  //
  // No live caller reaches it: `isTraversingStoragePath`
  // (`lib/services/medias/mediaFileUrl.ts`) refuses every absolute path before
  // one can be handed to a driver, and each driver's root comes from config
  // rather than from a row. It is also the one input where the `path.relative`
  // spelling that `scripts/backup/actorArchive.ts`'s `copyProfileImage` used
  // before #1583 disagreed — `path.win32.relative` of
  // `'C:\\staging\\files'` against `'c:\\STAGING\\FILES\\ab\\cd.webp'` answers
  // `'ab\\cd.webp'`, an accept, where the prefix compare here refuses.
  //
  // So loosening this means re-arguing that trade, not deleting a line nobody
  // wrote down a reason for.
  it('refuses an absolute path whose root differs only in letter case', () => {
    expect(
      resolveStorageFilePath(
        STORAGE_ROOT,
        '/SRV/activities/uploads/avatar.webp'
      )
    ).toBeNull()
  })

  it('resolves a relative storage root against the working directory', () => {
    expect(resolveStorageFilePath('uploads', 'avatar.webp')).toBe(
      path.resolve('uploads', 'avatar.webp')
    )
  })

  it('logs the refusal, which is the only signal a caller gets', () => {
    resolveStorageFilePath(STORAGE_ROOT, '../secret.webp')

    // A refused path returns null and nothing else. Without this line an
    // invariant that only ever fires on a caller nobody has written yet would
    // look like a delete that quietly did nothing.
    expect(logger.warn).toHaveBeenCalledWith({
      message: 'Refused a storage path outside the storage root',
      storageRootPath: STORAGE_ROOT,
      filePath: '../secret.webp'
    })
  })

  it('stays quiet for a path inside the root', () => {
    resolveStorageFilePath(STORAGE_ROOT, 'nested/../avatar.webp')

    expect(logger.warn).not.toHaveBeenCalled()
  })
})

describe('assertStorageFilePath', () => {
  it('returns the contained path', () => {
    expect(assertStorageFilePath(STORAGE_ROOT, 'avatar.webp')).toBe(
      `${STORAGE_ROOT}/avatar.webp`
    )
  })

  it('throws when the path escapes the storage root', () => {
    expect(() => assertStorageFilePath(STORAGE_ROOT, '../secret.webp')).toThrow(
      'Storage path escapes storage root'
    )
  })
})
