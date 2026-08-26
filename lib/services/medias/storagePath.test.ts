import path from 'path'

import { assertStorageFilePath, resolveStorageFilePath } from './storagePath'

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
      description: 'an inner traversal that stays inside the root',
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
