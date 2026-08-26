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
