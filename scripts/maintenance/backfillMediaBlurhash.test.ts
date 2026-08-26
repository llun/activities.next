import knex, { Knex } from 'knex'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CliOptions,
  InstanceHosts,
  backfillAttachments,
  backfillMedias,
  buildInstanceHosts,
  downloadRemoteImage,
  getAttachmentMediaHost,
  getLocalStoragePath,
  parseArgs
} from './backfillMediaBlurhash'

vi.mock('@/lib/utils/safeImageDownloadUrl', () => ({
  getSafeImageDownloadUrl: vi.fn()
}))

vi.mock('@/lib/services/medias/imageAnalysis', () => ({
  analyzeImageBuffer: vi.fn()
}))

const { getSafeImageDownloadUrl } = await vi.importMock<
  typeof import('@/lib/utils/safeImageDownloadUrl')
>('@/lib/utils/safeImageDownloadUrl')

const { analyzeImageBuffer } = await vi.importMock<
  typeof import('@/lib/services/medias/imageAnalysis')
>('@/lib/services/medias/imageAnalysis')

const HOSTS: InstanceHosts = buildInstanceHosts({
  host: 'llun.test',
  trustedHosts: ['alias.llun.test']
})

describe('backfillMediaBlurhash parseArgs', () => {
  it('parses flags correctly', () => {
    expect(parseArgs([])).toEqual({
      batchSize: 50,
      dryRun: false,
      force: false,
      localOnly: false
    })

    expect(
      parseArgs(['--dry-run', '--force', '--local-only', '--batch-size=100'])
    ).toEqual({
      batchSize: 100,
      dryRun: true,
      force: true,
      localOnly: true
    })

    expect(parseArgs(['--batch-size', '25'])).toEqual({
      batchSize: 25,
      dryRun: false,
      force: false,
      localOnly: false
    })
  })
})

describe('buildInstanceHosts', () => {
  it.each([
    {
      description: 'strips a scheme from the configured host',
      host: 'https://llun.test',
      expected: 'llun.test'
    },
    {
      description: 'strips a trailing path',
      host: 'llun.test/',
      expected: 'llun.test'
    },
    { description: 'lowercases', host: 'LLUN.test', expected: 'llun.test' },
    {
      description: 'drops an explicit https default port',
      host: 'llun.test:443',
      expected: 'llun.test'
    },
    {
      description: 'keeps a non-default port',
      host: 'localhost:3000',
      expected: 'localhost:3000'
    }
  ])('$description', ({ host, expected }) => {
    expect(buildInstanceHosts({ host }).fallbackHost).toBe(expected)
  })

  it('carries every trusted host into ownHosts', () => {
    const { ownHosts } = buildInstanceHosts({
      host: 'llun.test',
      trustedHosts: ['https://alias.llun.test', 'other.test:443']
    })
    expect([...ownHosts].sort()).toEqual([
      'alias.llun.test',
      'llun.test',
      'other.test'
    ])
  })

  it('drops empty host entries rather than matching an empty authority', () => {
    const { ownHosts } = buildInstanceHosts({
      host: 'llun.test',
      trustedHosts: ['', '   ']
    })
    expect(ownHosts.has('')).toBe(false)
    expect(ownHosts.size).toBe(1)
  })
})

describe('getLocalStoragePath', () => {
  it('recovers the stored path from a URL on the configured host', () => {
    expect(
      getLocalStoragePath(
        'https://llun.test/api/v1/files/medias/a.jpg',
        HOSTS.ownHosts
      )
    ).toBe('medias/a.jpg')
  })

  it('recovers the stored path from a URL on a trusted alias host', () => {
    expect(
      getLocalStoragePath(
        'https://alias.llun.test/api/v1/files/medias/a.jpg',
        HOSTS.ownHosts
      )
    ).toBe('medias/a.jpg')
  })

  // The regression this guards: `/api/v1/files/` is this project's own route,
  // so every OTHER activities.next instance serves attachments under exactly
  // that path. A substring match called those local storage paths.
  it('returns null for the same path on a remote instance', () => {
    expect(
      getLocalStoragePath(
        'https://remote.example/api/v1/files/medias/a.jpg',
        HOSTS.ownHosts
      )
    ).toBeNull()
  })

  it('returns null when the path only appears inside a query string', () => {
    expect(
      getLocalStoragePath(
        'https://remote.example/redirect?to=/api/v1/files/medias/a.jpg',
        HOSTS.ownHosts
      )
    ).toBeNull()
  })

  it('accepts a host-relative URL', () => {
    expect(
      getLocalStoragePath('/api/v1/files/medias/a.jpg', HOSTS.ownHosts)
    ).toBe('medias/a.jpg')
  })

  it('ignores a query string on our own URL', () => {
    expect(
      getLocalStoragePath(
        'https://llun.test/api/v1/files/medias/a.jpg?v=2',
        HOSTS.ownHosts
      )
    ).toBe('medias/a.jpg')
  })

  it('decodes a percent-encoded path', () => {
    expect(
      getLocalStoragePath(
        'https://llun.test/api/v1/files/medias/a%20b.jpg',
        HOSTS.ownHosts
      )
    ).toBe('medias/a b.jpg')
  })

  it.each([
    {
      description: 'returns null for another route on our host',
      url: 'https://llun.test/api/v1/statuses/1'
    },
    {
      description: 'returns null for an empty stored path',
      url: 'https://llun.test/api/v1/files/'
    },
    { description: 'returns null for an unparseable URL', url: 'not a url' }
  ])('$description', ({ url }) => {
    expect(getLocalStoragePath(url, HOSTS.ownHosts)).toBeNull()
  })
})

describe('getAttachmentMediaHost', () => {
  it.each([
    {
      description: 'takes the authority of the owning actor',
      actorId: 'https://alias.llun.test/users/test',
      expected: 'alias.llun.test'
    },
    {
      description: 'keeps a non-default port',
      actorId: 'http://localhost:3000/users/test',
      expected: 'localhost:3000'
    },
    {
      description: 'falls back when the actor id is not a URL',
      actorId: 'not-a-url',
      expected: 'llun.test'
    },
    {
      description: 'falls back when the attachment has no actor',
      actorId: null,
      expected: 'llun.test'
    }
  ])('$description', ({ actorId, expected }) => {
    expect(getAttachmentMediaHost(actorId, 'llun.test')).toBe(expected)
  })
})

describe('downloadRemoteImage', () => {
  beforeEach(() => {
    vi.mocked(getSafeImageDownloadUrl).mockReset()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null without fetching when the URL is refused by the guard', async () => {
    vi.mocked(getSafeImageDownloadUrl).mockResolvedValue(null)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    expect(await downloadRemoteImage('http://169.254.169.254/x.jpg')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns null when the response is not an image', async () => {
    const url = new URL('https://remote.example/x.jpg')
    vi.mocked(getSafeImageDownloadUrl).mockResolvedValue(url)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html></html>', {
        headers: { 'content-type': 'text/html; charset=utf-8' }
      })
    )

    expect(await downloadRemoteImage(url.toString())).toBeNull()
  })

  it('returns null on a non-ok response', async () => {
    const url = new URL('https://remote.example/x.jpg')
    vi.mocked(getSafeImageDownloadUrl).mockResolvedValue(url)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('nope', { status: 404 })
    )

    expect(await downloadRemoteImage(url.toString())).toBeNull()
  })

  it('returns the bytes for an image response', async () => {
    const url = new URL('https://remote.example/x.jpg')
    vi.mocked(getSafeImageDownloadUrl).mockResolvedValue(url)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'content-type': 'image/jpeg' }
      })
    )

    const buffer = await downloadRemoteImage(url.toString())
    expect(buffer && [...buffer]).toEqual([1, 2, 3])
  })

  // `readResponseArrayBufferWithLimit` throws once the running total passes the
  // cap, which is what stops a hostile row from being read into memory whole.
  it('throws rather than buffering a body past the size cap', async () => {
    const url = new URL('https://remote.example/huge.jpg')
    vi.mocked(getSafeImageDownloadUrl).mockResolvedValue(url)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array(11 * 1024 * 1024), {
        headers: { 'content-type': 'image/jpeg' }
      })
    )

    await expect(downloadRemoteImage(url.toString())).rejects.toThrow(
      /exceeds byte limit/
    )
  })
})

describe('backfillMediaBlurhash execution', () => {
  let db: Knex

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    db = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })

    await db.schema.createTable('medias', (table) => {
      table.increments('id').primary()
      table.string('actorId')
      table.string('original')
      table.integer('originalBytes')
      table.string('originalMimeType')
      table.string('thumbnail')
      table.integer('thumbnailBytes')
      table.string('thumbnailMimeType')
      table.float('focusX').nullable()
      table.float('focusY').nullable()
      table.string('blurhash').nullable()
    })

    await db.schema.createTable('attachments', (table) => {
      table.string('id').primary()
      table.string('statusId')
      table.string('actorId')
      table.string('mediaId').nullable()
      table.string('mediaType')
      table.string('url')
      table.integer('width')
      table.integer('height')
      table.string('name')
      table.string('blurhash').nullable()
      table.float('focusX').nullable()
      table.float('focusY').nullable()
      table.string('thumbnailUrl').nullable()
      table.timestamp('createdAt').defaultTo(db.fn.now())
      table.timestamp('updatedAt').defaultTo(db.fn.now())
    })
  })

  afterEach(async () => {
    await db.destroy()
    vi.restoreAllMocks()
  })

  const options = (overrides: Partial<CliOptions> = {}): CliOptions => ({
    batchSize: 50,
    dryRun: false,
    force: false,
    localOnly: false,
    ...overrides
  })

  it('backfills attachments linked to media rows', async () => {
    await db('medias').insert({
      id: 1,
      actorId: 'actor-1',
      original: 'orig.jpg',
      originalBytes: 100,
      originalMimeType: 'image/jpeg',
      blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4',
      focusX: 0.25,
      focusY: -0.5
    })

    await db('attachments').insert({
      id: 'att-1',
      statusId: 'status-1',
      actorId: 'https://llun.test/users/test',
      mediaId: '1',
      mediaType: 'image/jpeg',
      url: 'https://llun.test/api/v1/files/orig.jpg',
      blurhash: null,
      focusX: null,
      focusY: null
    })

    const mockStorage = {
      getFile: vi.fn().mockResolvedValue(null)
    } as never

    await backfillAttachments(db, mockStorage, options(), HOSTS)

    const updated = await db('attachments').where('id', 'att-1').first()
    expect(updated.blurhash).toBe('L6PZfSi_.AyE_3t7t7R**0o#DgR4')
    expect(updated.focusX).toBe(0.25)
    expect(updated.focusY).toBe(-0.5)
  })

  // `thumbnailUrl` is served to clients verbatim as Mastodon's `preview_url`
  // and as a <video> poster, so a host-relative value is unusable to a native
  // client that is not talking to this origin.
  it('writes an absolute thumbnailUrl on the owning actor host', async () => {
    await db('medias').insert({
      id: 1,
      actorId: 'actor-1',
      original: 'medias/orig.jpg',
      originalBytes: 100,
      originalMimeType: 'image/jpeg',
      thumbnail: 'medias/orig-thumbnail.jpg',
      blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4'
    })

    await db('attachments').insert({
      id: 'att-1',
      statusId: 'status-1',
      actorId: 'https://alias.llun.test/users/test',
      mediaId: '1',
      mediaType: 'image/jpeg',
      url: 'https://alias.llun.test/api/v1/files/medias/orig.jpg',
      blurhash: null,
      thumbnailUrl: null
    })

    const mockStorage = {
      getFile: vi.fn().mockResolvedValue(null)
    } as never

    await backfillAttachments(db, mockStorage, options(), HOSTS)

    const updated = await db('attachments').where('id', 'att-1').first()
    expect(updated.thumbnailUrl).toBe(
      'https://alias.llun.test/api/v1/files/medias/orig-thumbnail.jpg'
    )
  })

  // Without --force every per-row step fills a missing value only, so the flag
  // dropping `whereNull('blurhash')` from the query updated nothing.
  it('recomputes an existing attachment blurhash from the media row under --force', async () => {
    await db('medias').insert({
      id: 1,
      actorId: 'actor-1',
      original: 'orig.jpg',
      originalBytes: 100,
      originalMimeType: 'image/jpeg',
      blurhash: 'LKO2:N%2Tw=w]~RBVZRi};RPxuwH'
    })

    await db('attachments').insert({
      id: 'att-1',
      statusId: 'status-1',
      actorId: 'https://llun.test/users/test',
      mediaId: '1',
      mediaType: 'image/jpeg',
      url: 'https://llun.test/api/v1/files/orig.jpg',
      blurhash: 'STALEHASHSTALEHASH'
    })

    const mockStorage = {
      getFile: vi.fn().mockResolvedValue(null)
    } as never

    await backfillAttachments(db, mockStorage, options({ force: true }), HOSTS)

    const updated = await db('attachments').where('id', 'att-1').first()
    expect(updated.blurhash).toBe('LKO2:N%2Tw=w]~RBVZRi};RPxuwH')
  })

  it('leaves an existing attachment blurhash alone without --force', async () => {
    await db('medias').insert({
      id: 1,
      actorId: 'actor-1',
      original: 'orig.jpg',
      originalBytes: 100,
      originalMimeType: 'image/jpeg',
      blurhash: 'LKO2:N%2Tw=w]~RBVZRi};RPxuwH'
    })

    await db('attachments').insert({
      id: 'att-1',
      statusId: 'status-1',
      actorId: 'https://llun.test/users/test',
      mediaId: '1',
      mediaType: 'image/jpeg',
      url: 'https://llun.test/api/v1/files/orig.jpg',
      blurhash: 'STALEHASHSTALEHASH'
    })

    const mockStorage = {
      getFile: vi.fn().mockResolvedValue(null)
    } as never

    await backfillAttachments(db, mockStorage, options(), HOSTS)

    const updated = await db('attachments').where('id', 'att-1').first()
    expect(updated.blurhash).toBe('STALEHASHSTALEHASH')
  })

  // A remote instance runs this same code, so its attachment URLs carry exactly
  // the `/api/v1/files/` path. Reading one out of OUR storage is both wrong and
  // a way to make the sweep look at a path the remote actor chose.
  it('does not read a remote instance URL out of local storage', async () => {
    await db('attachments').insert({
      id: 'att-1',
      statusId: 'status-1',
      actorId: 'https://remote.example/users/them',
      mediaId: null,
      mediaType: 'image/jpeg',
      url: 'https://remote.example/api/v1/files/../../secret.jpg',
      blurhash: null
    })

    const getFile = vi.fn().mockResolvedValue(null)
    const mockStorage = { getFile } as never

    await backfillAttachments(
      db,
      mockStorage,
      options({ localOnly: true }),
      HOSTS
    )

    expect(getFile).not.toHaveBeenCalled()
  })

  it('skips the remote download entirely under --local-only', async () => {
    vi.mocked(getSafeImageDownloadUrl).mockReset()

    await db('attachments').insert({
      id: 'att-1',
      statusId: 'status-1',
      actorId: 'https://remote.example/users/them',
      mediaId: null,
      mediaType: 'image/jpeg',
      url: 'https://remote.example/media/photo.jpg',
      blurhash: null
    })

    const mockStorage = {
      getFile: vi.fn().mockResolvedValue(null)
    } as never

    await backfillAttachments(
      db,
      mockStorage,
      options({ localOnly: true }),
      HOSTS
    )

    expect(getSafeImageDownloadUrl).not.toHaveBeenCalled()
    const updated = await db('attachments').where('id', 'att-1').first()
    expect(updated.blurhash).toBeNull()
  })

  it('runs a remote attachment URL through the download guard by default', async () => {
    vi.mocked(getSafeImageDownloadUrl).mockReset()
    vi.mocked(getSafeImageDownloadUrl).mockResolvedValue(null)

    await db('attachments').insert({
      id: 'att-1',
      statusId: 'status-1',
      actorId: 'https://remote.example/users/them',
      mediaId: null,
      mediaType: 'image/jpeg',
      url: 'https://remote.example/media/photo.jpg',
      blurhash: null
    })

    const mockStorage = {
      getFile: vi.fn().mockResolvedValue(null)
    } as never

    await backfillAttachments(db, mockStorage, options(), HOSTS)

    expect(getSafeImageDownloadUrl).toHaveBeenCalledWith(
      'https://remote.example/media/photo.jpg'
    )
  })
})

describe('backfillMedias', () => {
  let db: Knex

  const options = (overrides: Partial<CliOptions> = {}): CliOptions => ({
    batchSize: 50,
    dryRun: false,
    force: false,
    localOnly: false,
    ...overrides
  })

  const storage = () =>
    ({
      getFile: vi
        .fn()
        .mockResolvedValue({ type: 'buffer', buffer: Buffer.from([1, 2, 3]) })
    }) as never

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.mocked(analyzeImageBuffer).mockReset()

    db = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })

    await db.schema.createTable('medias', (table) => {
      table.increments('id').primary()
      table.string('actorId')
      table.string('original')
      table.string('originalMimeType')
      table.string('thumbnail')
      table.float('focusX').nullable()
      table.float('focusY').nullable()
      table.string('blurhash').nullable()
    })
  })

  afterEach(async () => {
    await db.destroy()
    vi.restoreAllMocks()
  })

  const insertMedia = (row: Record<string, unknown>) =>
    db('medias').insert({
      id: 1,
      actorId: 'actor-1',
      original: 'orig.jpg',
      originalMimeType: 'image/jpeg',
      ...row
    })

  it('writes a computed blurhash and focus onto an empty row', async () => {
    await insertMedia({ blurhash: null, focusX: null, focusY: null })
    vi.mocked(analyzeImageBuffer).mockResolvedValue({
      blurhash: 'FRESHHASH',
      focus: { x: 0.5, y: -0.25 }
    })

    await backfillMedias(db, storage(), options())

    const updated = await db('medias').where('id', 1).first()
    expect(updated.blurhash).toBe('FRESHHASH')
    expect(updated.focusX).toBe(0.5)
    expect(updated.focusY).toBe(-0.25)
  })

  // --force re-reads rows that already have a blurhash. When the recomputed
  // value matches, the row still has a missing focal point worth filling.
  it('fills a missing focal point under --force even when the blurhash is unchanged', async () => {
    await insertMedia({ blurhash: 'SAMEHASH', focusX: null, focusY: null })
    vi.mocked(analyzeImageBuffer).mockResolvedValue({
      blurhash: 'SAMEHASH',
      focus: { x: 0.1, y: 0.2 }
    })

    await backfillMedias(db, storage(), options({ force: true }))

    const updated = await db('medias').where('id', 1).first()
    expect(updated.focusX).toBe(0.1)
    expect(updated.focusY).toBe(0.2)
  })

  // A stored focal point may have been set by hand through
  // `PUT /api/v1/media/:id`, and nothing records that it was, so --force must
  // not overwrite it.
  it('never overwrites an existing focal point under --force', async () => {
    await insertMedia({ blurhash: 'OLDHASH', focusX: 0.9, focusY: -0.9 })
    vi.mocked(analyzeImageBuffer).mockResolvedValue({
      blurhash: 'NEWHASH',
      focus: { x: 0, y: 0 }
    })

    await backfillMedias(db, storage(), options({ force: true }))

    const updated = await db('medias').where('id', 1).first()
    expect(updated.blurhash).toBe('NEWHASH')
    expect(updated.focusX).toBe(0.9)
    expect(updated.focusY).toBe(-0.9)
  })

  it('passes an existing focal point back as the manual focus', async () => {
    await insertMedia({ blurhash: null, focusX: 0.4, focusY: -0.6 })
    vi.mocked(analyzeImageBuffer).mockResolvedValue({
      blurhash: 'FRESHHASH',
      focus: { x: 0.4, y: -0.6 }
    })

    await backfillMedias(db, storage(), options())

    expect(analyzeImageBuffer).toHaveBeenCalledWith(expect.anything(), {
      manualFocus: { x: 0.4, y: -0.6 }
    })
  })

  it('leaves a row untouched when nothing changed', async () => {
    await insertMedia({ blurhash: 'SAMEHASH', focusX: 0.1, focusY: 0.2 })
    vi.mocked(analyzeImageBuffer).mockResolvedValue({
      blurhash: 'SAMEHASH',
      focus: { x: 0.1, y: 0.2 }
    })

    await backfillMedias(db, storage(), options({ force: true }))

    const logged = vi
      .mocked(console.log)
      .mock.calls.map((call) => String(call[0]))
    expect(logged).toContain('Medias complete: processed 1, updated 0')
  })
})
