import { excludeManagedStorageFiles } from './cleanupMediaStorage'

describe('excludeManagedStorageFiles', () => {
  it('skips raw PDS blobs so they are never reported as orphaned media', () => {
    const { files, skipped } = excludeManagedStorageFiles(
      [
        'medias/2026/01/photo.webp',
        'pds-blobs/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef/bafkreione',
        'pds-blobs/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef/bafkreitwo',
        'archives/archive-1/token/archive.zip',
        'imports/import-1/token/upload.zip'
      ],
      null
    )

    expect(files).toEqual(['medias/2026/01/photo.webp'])
    expect(skipped).toEqual({
      archives: 1,
      fitness: 0,
      imports: 1,
      pdsBlobs: 2
    })
  })

  it('matches the PDS blob prefix without case and at the prefix itself', () => {
    const { files, skipped } = excludeManagedStorageFiles(
      ['PDS-Blobs/hash/cid', 'pds-blobs', 'medias/keep.webp'],
      null
    )

    expect(files).toEqual(['medias/keep.webp'])
    expect(skipped.pdsBlobs).toBe(2)
  })

  it('skips the shared fitness prefix and the other managed namespaces together', () => {
    const { files, skipped } = excludeManagedStorageFiles(
      [
        'medias/keep.webp',
        'fitness/2026-01-01/activity.fit',
        'archives/a/t/archive.zip',
        'imports/a/t/upload.zip',
        'pds-blobs/hash/cid'
      ],
      'fitness/'
    )

    expect(files).toEqual(['medias/keep.webp'])
    expect(skipped).toEqual({
      archives: 1,
      fitness: 1,
      imports: 1,
      pdsBlobs: 1
    })
  })
})
