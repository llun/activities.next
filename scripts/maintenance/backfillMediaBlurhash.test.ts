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
  getFileBuffer,
  getLocalStoragePath,
  parseArgs
} from './backfillMediaBlurhash'

vi.mock('@/lib/utils/safeImageDownload', () => ({
  safeImageFetch: vi.fn()
}))

vi.mock('@/lib/services/medias/imageAnalysis', () => ({
  analyzeImageBuffer: vi.fn()
}))

const { safeImageFetch } = await vi.importMock<
  typeof import('@/lib/utils/safeImageDownload')
>('@/lib/utils/safeImageDownload')

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

  it('carries every trusted host into the rule list', () => {
    const { ownHostRules } = buildInstanceHosts({
      host: 'llun.test',
      trustedHosts: ['https://alias.llun.test', 'other.test:443']
    })
    expect(ownHostRules).toEqual([
      'llun.test',
      'https://alias.llun.test',
      'other.test:443'
    ])
  })

  it('drops empty host entries rather than matching an empty authority', () => {
    const { ownHostRules } = buildInstanceHosts({
      host: 'llun.test',
      trustedHosts: ['', '   ']
    })
    expect(ownHostRules).toEqual(['llun.test'])
  })
})

describe('getLocalStoragePath', () => {
  it('recovers the stored path from a URL on the configured host', () => {
    expect(
      getLocalStoragePath(
        'https://llun.test/api/v1/files/medias/a.jpg',
        HOSTS.ownHostRules
      )
    ).toBe('medias/a.jpg')
  })

  it('recovers the stored path from a URL on a trusted alias host', () => {
    expect(
      getLocalStoragePath(
        'https://alias.llun.test/api/v1/files/medias/a.jpg',
        HOSTS.ownHostRules
      )
    ).toBe('medias/a.jpg')
  })

  // The regression this guards: `/api/v1/files/` is this project's own route,
  // so every OTHER activities.next instance serves attachments under exactly
  // that path. A substring match called those local storage paths.
  // `ACTIVITIES_TRUSTED_HOSTS` supports `*.example.com` entries everywhere else
  // in the app, so a literal Set lookup silently disowned a wildcard-covered
  // subdomain's own storage URLs.
  it('recovers the stored path from a wildcard-trusted subdomain', () => {
    const { ownHostRules } = buildInstanceHosts({
      host: 'llun.test',
      trustedHosts: ['*.llun.test']
    })
    expect(
      getLocalStoragePath(
        'https://tenant1.llun.test/api/v1/files/medias/a.jpg',
        ownHostRules
      )
    ).toBe('medias/a.jpg')
  })

  // `new URL` parses `*` in an authority, and `normalizeHost` refuses a
  // wildcard, so the literal-equality fallback used to compare the authority
  // against the wildcard RULE's own spelling and call it ours — letting a
  // federated attachment url read an attacker-chosen path out of local storage.
  it('refuses an authority that is literally the wildcard pattern', () => {
    const { ownHostRules } = buildInstanceHosts({
      host: 'llun.test',
      trustedHosts: ['*.llun.test']
    })
    expect(
      getLocalStoragePath(
        'https://*.llun.test/api/v1/files/other/actors/private.jpg',
        ownHostRules
      )
    ).toBeNull()
  })

  // A protocol-relative URL carries its own authority; resolving it against a
  // placeholder origin silently discarded it and made any host look local.
  // A raw `!startsWith('//')` test is not enough: the WHATWG parser reads `\`
  // as `/` for a special scheme and strips tab/LF/CR before parsing, so all of
  // these grow an authority without beginning with `//`.
  it.each([
    { description: 'refuses a protocol-relative URL', prefix: '//' },
    { description: 'refuses a backslash authority', prefix: '/\\' },
    { description: 'refuses a doubled backslash authority', prefix: '/\\\\' },
    { description: 'refuses a tab-smuggled authority', prefix: '/\t/' },
    { description: 'refuses a newline-smuggled authority', prefix: '/\n/' },
    {
      description: 'refuses a carriage-return-smuggled authority',
      prefix: '/\r/'
    },
    { description: 'refuses a tab-plus-backslash authority', prefix: '/\t\\' }
  ])('$description', ({ prefix }) => {
    expect(
      getLocalStoragePath(
        `${prefix}evil.example/api/v1/files/medias/a.jpg`,
        HOSTS.ownHostRules
      )
    ).toBeNull()
  })

  it('still refuses a foreign host when a wildcard rule is configured', () => {
    const { ownHostRules } = buildInstanceHosts({
      host: 'llun.test',
      trustedHosts: ['*.llun.test']
    })
    expect(
      getLocalStoragePath(
        'https://evil.example/api/v1/files/medias/a.jpg',
        ownHostRules
      )
    ).toBeNull()
  })

  it('recognises a loopback host that normalizeHost refuses', () => {
    const { ownHostRules } = buildInstanceHosts({ host: 'localhost:3000' })
    expect(
      getLocalStoragePath(
        'http://localhost:3000/api/v1/files/medias/a.jpg',
        ownHostRules
      )
    ).toBe('medias/a.jpg')
  })

  // `new URL` normalises a literal `../`, but a percent-encoded one survives
  // it and decoding puts it back — so the check has to happen after decoding.
  it.each([
    {
      description: 'rejects a percent-encoded traversal',
      url: 'https://llun.test/api/v1/files/%2e%2e%2f%2e%2e%2fetc/passwd'
    },
    {
      description: 'rejects an encoded-slash traversal',
      url: 'https://llun.test/api/v1/files/..%2F..%2Fetc%2Fpasswd'
    },
    {
      description: 'rejects a decoded absolute path',
      url: 'https://llun.test/api/v1/files/%2Fetc%2Fpasswd'
    },
    {
      description: 'rejects a host-relative traversal',
      url: '/api/v1/files/../../../../etc/passwd'
    },
    // The traversal rule is shared with `getMediaPathFromFileUrl`, so this
    // sweep refuses the Windows spellings its own copy used to let through.
    {
      description: 'rejects an encoded-backslash traversal',
      url: 'https://llun.test/api/v1/files/..%5c..%5csecrets'
    },
    {
      description: 'rejects a Windows drive-letter path',
      url: 'https://llun.test/api/v1/files/C:%5CWindows%5Cwin.ini'
    },
    {
      description: 'rejects a path carrying a NUL byte',
      url: 'https://llun.test/api/v1/files/ab%00.webp'
    }
  ])('$description', ({ url }) => {
    expect(getLocalStoragePath(url, HOSTS.ownHostRules)).toBeNull()
  })

  it('returns null for the same path on a remote instance', () => {
    expect(
      getLocalStoragePath(
        'https://remote.example/api/v1/files/medias/a.jpg',
        HOSTS.ownHostRules
      )
    ).toBeNull()
  })

  it('returns null when the path only appears inside a query string', () => {
    expect(
      getLocalStoragePath(
        'https://remote.example/redirect?to=/api/v1/files/medias/a.jpg',
        HOSTS.ownHostRules
      )
    ).toBeNull()
  })

  it('accepts a host-relative URL', () => {
    expect(
      getLocalStoragePath('/api/v1/files/medias/a.jpg', HOSTS.ownHostRules)
    ).toBe('medias/a.jpg')
  })

  it('ignores a query string on our own URL', () => {
    expect(
      getLocalStoragePath(
        'https://llun.test/api/v1/files/medias/a.jpg?v=2',
        HOSTS.ownHostRules
      )
    ).toBe('medias/a.jpg')
  })

  it('decodes a percent-encoded path', () => {
    expect(
      getLocalStoragePath(
        'https://llun.test/api/v1/files/medias/a%20b.jpg',
        HOSTS.ownHostRules
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
    expect(getLocalStoragePath(url, HOSTS.ownHostRules)).toBeNull()
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
    vi.mocked(safeImageFetch).mockReset()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const imageResponse = (
    body: Uint8Array<ArrayBuffer>,
    contentType = 'image/jpeg'
  ) => new Response(body, { headers: { 'content-type': contentType } })

  it('returns null when the guarded fetch refuses the URL', async () => {
    vi.mocked(safeImageFetch).mockResolvedValue(null)

    expect(await downloadRemoteImage('http://169.254.169.254/x.jpg')).toBeNull()
    expect(safeImageFetch).toHaveBeenCalledWith('http://169.254.169.254/x.jpg')
  })

  it('returns null when the response is not an image', async () => {
    vi.mocked(safeImageFetch).mockResolvedValue(
      new Response('<html></html>', {
        headers: { 'content-type': 'text/html; charset=utf-8' }
      })
    )

    expect(await downloadRemoteImage('https://remote.example/x.jpg')).toBeNull()
  })

  it('returns null on a non-ok response', async () => {
    vi.mocked(safeImageFetch).mockResolvedValue(
      new Response('nope', { status: 404 })
    )

    expect(await downloadRemoteImage('https://remote.example/x.jpg')).toBeNull()
  })

  it('returns the bytes for an image response', async () => {
    vi.mocked(safeImageFetch).mockResolvedValue(
      imageResponse(new Uint8Array([1, 2, 3]))
    )

    const buffer = await downloadRemoteImage('https://remote.example/x.jpg')
    expect(buffer && [...buffer]).toEqual([1, 2, 3])
  })

  it('returns null rather than an empty buffer for a zero-length body', async () => {
    vi.mocked(safeImageFetch).mockResolvedValue(
      imageResponse(new Uint8Array([]))
    )

    expect(await downloadRemoteImage('https://remote.example/x.jpg')).toBeNull()
  })

  // The cap is enforced inside `readResponseArrayBufferWithLimit`, which
  // throws. `downloadRemoteImage` swallows that so one hostile row cannot end
  // the sweep — its doc comment promises exactly this, so it is worth pinning.
  it('returns null and warns instead of buffering a body past the size cap', async () => {
    vi.mocked(safeImageFetch).mockResolvedValue(
      imageResponse(new Uint8Array(11 * 1024 * 1024))
    )

    expect(
      await downloadRemoteImage('https://remote.example/huge.jpg')
    ).toBeNull()
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('huge.jpg'),
      expect.objectContaining({
        message: expect.stringContaining('byte limit')
      })
    )
  })

  it('returns null and warns when the guarded fetch itself throws', async () => {
    vi.mocked(safeImageFetch).mockRejectedValue(new Error('network down'))

    expect(await downloadRemoteImage('https://remote.example/x.jpg')).toBeNull()
    expect(console.warn).toHaveBeenCalled()
  })
})

describe('backfillMediaBlurhash execution', () => {
  let db: Knex

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    // `vi.restoreAllMocks()` in `afterEach` only iterates the spies `vi.spyOn`
    // registered, so it never reaches a `vi.fn()` created inside a `vi.mock`
    // factory. Without these two, every test in this block inherits whatever
    // its predecessor last told these mocks to return.
    vi.mocked(analyzeImageBuffer).mockReset()
    vi.mocked(safeImageFetch).mockReset()

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

  // An earlier version of this script wrote the blurhash and a HOST-RELATIVE
  // thumbnailUrl in the same pass. Those rows are precisely the ones the
  // absolute-URL fix exists for, and `whereNull('blurhash')` would never
  // revisit them — so a plain re-run left every one of them broken.
  it('repairs a relative thumbnailUrl an earlier run wrote, without --force', async () => {
    await db('medias').insert({
      id: 1,
      actorId: 'actor-1',
      original: 'medias/orig.jpg',
      originalMimeType: 'image/jpeg',
      thumbnail: 'medias/orig-thumbnail.jpg',
      blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4'
    })

    await db('attachments').insert({
      id: 'att-1',
      statusId: 'status-1',
      actorId: 'https://llun.test/users/test',
      mediaId: '1',
      mediaType: 'image/jpeg',
      url: 'https://llun.test/api/v1/files/medias/orig.jpg',
      // Both already set by the earlier run.
      blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4',
      thumbnailUrl: '/api/v1/files/medias/orig-thumbnail.jpg'
    })

    const mockStorage = {
      getFile: vi.fn().mockResolvedValue(null)
    } as never

    await backfillAttachments(db, mockStorage, options(), HOSTS)

    const updated = await db('attachments').where('id', 'att-1').first()
    expect(updated.thumbnailUrl).toBe(
      'https://llun.test/api/v1/files/medias/orig-thumbnail.jpg'
    )
  })

  it('leaves an already-absolute thumbnailUrl alone without --force', async () => {
    await db('medias').insert({
      id: 1,
      actorId: 'actor-1',
      original: 'medias/orig.jpg',
      originalMimeType: 'image/jpeg',
      thumbnail: 'medias/orig-thumbnail.jpg',
      blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4'
    })

    await db('attachments').insert({
      id: 'att-1',
      statusId: 'status-1',
      actorId: 'https://llun.test/users/test',
      mediaId: '1',
      mediaType: 'image/jpeg',
      url: 'https://llun.test/api/v1/files/medias/orig.jpg',
      blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4',
      thumbnailUrl:
        'https://cdn.llun.test/api/v1/files/medias/orig-thumbnail.jpg'
    })

    const mockStorage = {
      getFile: vi.fn().mockResolvedValue(null)
    } as never

    await backfillAttachments(db, mockStorage, options(), HOSTS)

    const updated = await db('attachments').where('id', 'att-1').first()
    expect(updated.thumbnailUrl).toBe(
      'https://cdn.llun.test/api/v1/files/medias/orig-thumbnail.jpg'
    )
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
      url: 'https://remote.example/api/v1/files/secret.jpg',
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

    expect(safeImageFetch).not.toHaveBeenCalled()
    const updated = await db('attachments').where('id', 'att-1').first()
    expect(updated.blurhash).toBeNull()
  })

  // The whole `if (buffer) { analyzeImageBuffer(...) }` block could be turned
  // into a no-op without failing anything: every other test in this block ends
  // with `buffer === null`.
  it('writes an analysed blurhash and focus back onto a local attachment', async () => {
    await db('attachments').insert({
      id: 'att-1',
      statusId: 'status-1',
      actorId: 'https://llun.test/users/test',
      mediaId: null,
      mediaType: 'image/jpeg',
      url: 'https://llun.test/api/v1/files/medias/a.jpg',
      blurhash: null,
      focusX: null,
      focusY: null
    })

    const mockStorage = {
      getFile: vi
        .fn()
        .mockResolvedValue({ type: 'buffer', buffer: Buffer.from([1, 2, 3]) })
    } as never
    vi.mocked(analyzeImageBuffer).mockResolvedValue({
      blurhash: 'ANALYSEDHASH',
      focus: { x: 0.3, y: -0.4 }
    })

    await backfillAttachments(db, mockStorage, options(), HOSTS)

    const updated = await db('attachments').where('id', 'att-1').first()
    expect(updated.blurhash).toBe('ANALYSEDHASH')
    expect(updated.focusX).toBe(0.3)
    expect(updated.focusY).toBe(-0.4)
  })

  it('analyses a remote attachment through the download guard', async () => {
    await db('attachments').insert({
      id: 'att-1',
      statusId: 'status-1',
      actorId: 'https://remote.example/users/them',
      mediaId: null,
      mediaType: 'image/jpeg',
      url: 'https://remote.example/media/photo.jpg',
      blurhash: null
    })

    vi.mocked(safeImageFetch).mockResolvedValue(
      new Response(new Uint8Array([9, 9, 9]), {
        headers: { 'content-type': 'image/jpeg' }
      })
    )
    vi.mocked(analyzeImageBuffer).mockResolvedValue({
      blurhash: 'REMOTEHASH',
      focus: null
    })

    const mockStorage = { getFile: vi.fn().mockResolvedValue(null) } as never
    await backfillAttachments(db, mockStorage, options(), HOSTS)

    const updated = await db('attachments').where('id', 'att-1').first()
    expect(updated.blurhash).toBe('REMOTEHASH')
  })

  it('warns when a local attachment file is missing from storage', async () => {
    await db('attachments').insert({
      id: 'att-1',
      statusId: 'status-1',
      actorId: 'https://llun.test/users/test',
      mediaId: null,
      mediaType: 'image/jpeg',
      url: 'https://llun.test/api/v1/files/medias/gone.jpg',
      blurhash: null
    })

    const mockStorage = { getFile: vi.fn().mockResolvedValue(null) } as never
    await backfillAttachments(db, mockStorage, options(), HOSTS)

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not read file buffer at medias/gone.jpg')
    )
  })

  // Deleting a `medias` row leaves every `attachments.mediaId` that pointed at
  // it dangling, and the sweep cannot repair such a row: the thumbnailUrl
  // rebuild is the media block's alone, so a host-relative value stays
  // host-relative and the row is re-selected by every later run. Before this
  // warning the operator saw only "processed 1, updated 0".
  //
  // The two causes are counted SEPARATELY on purpose. A deleted media row is
  // the expected residue of an owner deleting their own media; a `mediaId` that
  // was never a row id is a bad write (`createAttachment` does not validate it,
  // and `POST /api/v1/accounts/outbox` reaches it unvalidated) and is worth
  // investigating. Summing them would tell an operator to ignore the second.
  it.each([
    {
      description: 'a mediaId whose media row is gone',
      mediaId: '404',
      expectedWarning: 'media 404 no longer exists',
      expectedSummary:
        'Attachments complete: processed 1, updated 0, 1 whose media row is gone, 0 with an invalid mediaId'
    },
    {
      // This spelling needs SQLite's `varchar` column; `attachments.mediaId`
      // is `integer` on PostgreSQL, where the INSERT would fail first. The
      // BRANCH is not SQLite-only though — `-5` and `0` store fine on
      // PostgreSQL and `toMediaRowId` refuses them just the same. This file
      // builds its own `better-sqlite3` database, so no `TEST_DATABASE_TYPE`
      // exercises the PostgreSQL side either way.
      description: 'a mediaId that is not a row id',
      mediaId: 'abc',
      expectedWarning: 'mediaId "abc" is not a media row id',
      expectedSummary:
        'Attachments complete: processed 1, updated 0, 0 whose media row is gone, 1 with an invalid mediaId'
    }
  ])(
    'warns and counts an attachment with $description',
    async ({ mediaId, expectedWarning, expectedSummary }) => {
      await db('attachments').insert({
        id: 'att-1',
        statusId: 'status-1',
        actorId: 'https://llun.test/users/test',
        mediaId,
        mediaType: 'image/jpeg',
        url: 'https://llun.test/api/v1/files/medias/orig.jpg',
        // Already set, so the direct-analysis fallback never runs and the media
        // row is genuinely this row's only remaining source.
        blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4',
        thumbnailUrl: '/api/v1/files/medias/orig-thumbnail.jpg'
      })

      const mockStorage = { getFile: vi.fn().mockResolvedValue(null) } as never
      await backfillAttachments(db, mockStorage, options(), HOSTS)

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining(expectedWarning)
      )
      expect(console.log).toHaveBeenCalledWith(expectedSummary)

      // The warning is not redundant with an update: the row really is left as
      // it was, host-relative thumbnailUrl and all.
      const untouched = await db('attachments').where('id', 'att-1').first()
      expect(untouched.thumbnailUrl).toBe(
        '/api/v1/files/medias/orig-thumbnail.jpg'
      )
    }
  )

  // The counts do NOT partition `processed`. A row whose `mediaId` resolves to
  // nothing can still be repaired from its own image bytes, so the warning and
  // the repair have to be asserted TOGETHER — otherwise suppressing the warning
  // for exactly the self-healing rows passes. Both branches get a case, because
  // guarding one and not its twin leaves the same hole on the other side.
  //
  // Self-healing is reachable for a deleted media row too: the delete route
  // removes the stored bytes best-effort and drops the row regardless (see
  // `app/api/v1/accounts/media/[mediaId]/route.ts`), so the file behind `url`
  // can outlive the `medias` row that named it.
  it.each([
    {
      description: 'an invalid mediaId',
      mediaId: 'abc',
      expectedWarning: 'mediaId "abc" is not a media row id',
      expectedSummary:
        'Attachments complete: processed 1, updated 1, 0 whose media row is gone, 1 with an invalid mediaId'
    },
    {
      description: 'a deleted media row',
      mediaId: '404',
      expectedWarning: 'media 404 no longer exists',
      expectedSummary:
        'Attachments complete: processed 1, updated 1, 1 whose media row is gone, 0 with an invalid mediaId'
    }
  ])(
    'still warns for $description on a row it repairs',
    async ({ mediaId, expectedWarning, expectedSummary }) => {
      vi.mocked(analyzeImageBuffer).mockResolvedValue({
        blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4',
        focus: null
      })

      await db('attachments').insert({
        id: 'att-1',
        statusId: 'status-1',
        actorId: 'https://llun.test/users/test',
        mediaId,
        mediaType: 'image/jpeg',
        url: 'https://llun.test/api/v1/files/medias/orig.jpg',
        blurhash: null
      })

      const mockStorage = {
        getFile: vi
          .fn()
          .mockResolvedValue({ type: 'buffer', buffer: Buffer.from('image') })
      } as never
      await backfillAttachments(db, mockStorage, options(), HOSTS)

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining(expectedWarning)
      )
      expect(console.log).toHaveBeenCalledWith(expectedSummary)

      const repaired = await db('attachments').where('id', 'att-1').first()
      expect(repaired.blurhash).toBe('L6PZfSi_.AyE_3t7t7R**0o#DgR4')
    }
  )

  // `--dry-run` is the first command `docs/maintenance.md` tells an operator to
  // run, so the diagnostic has to survive it: the gate covers the UPDATE, not
  // the counting, and `totalUpdated` deliberately counts what WOULD be written.
  // The row has to be one that genuinely diverges, or the update block is never
  // entered and "without writing" asserts nothing — stripping the gate to an
  // unconditional write passed a fixture that could not reach it.
  it('counts a row it would write under --dry-run without writing it', async () => {
    vi.mocked(analyzeImageBuffer).mockResolvedValue({
      blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4',
      focus: null
    })

    await db('attachments').insert({
      id: 'att-1',
      statusId: 'status-1',
      actorId: 'https://llun.test/users/test',
      mediaId: '404',
      mediaType: 'image/jpeg',
      url: 'https://llun.test/api/v1/files/medias/one.jpg',
      blurhash: null
    })

    const mockStorage = {
      getFile: vi
        .fn()
        .mockResolvedValue({ type: 'buffer', buffer: Buffer.from('image') })
    } as never
    await backfillAttachments(db, mockStorage, options({ dryRun: true }), HOSTS)

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[attachments att-1] media 404 no longer exists')
    )
    expect(console.log).toHaveBeenCalledWith(
      'Attachments complete: processed 1, updated 1, 1 whose media row is gone, 0 with an invalid mediaId'
    )

    const untouched = await db('attachments').where('id', 'att-1').first()
    expect(untouched.blurhash).toBeNull()
  })

  // The warning is per ROW and each counter lives outside the batch loop, so
  // pinning either needs two rows OF THE SAME CAUSE spread over two batches.
  // Two rows with different causes does not do it: each counter only ever
  // reaches one, so collapsing the warning to one call per cause suppresses
  // nothing and the mutation passes.
  it.each([
    {
      description: 'a deleted media row',
      mediaIds: ['404', '405'],
      expectedWarnings: [
        '[attachments att-1] media 404 no longer exists',
        '[attachments att-2] media 405 no longer exists'
      ],
      expectedSummary:
        'Attachments complete: processed 2, updated 0, 2 whose media row is gone, 0 with an invalid mediaId'
    },
    {
      description: 'an invalid mediaId',
      mediaIds: ['nope', 'nah'],
      expectedWarnings: [
        '[attachments att-1] mediaId "nope" is not a media row id',
        '[attachments att-2] mediaId "nah" is not a media row id'
      ],
      expectedSummary:
        'Attachments complete: processed 2, updated 0, 0 whose media row is gone, 2 with an invalid mediaId'
    }
  ])(
    'warns per row and accumulates $description across batches',
    async ({ mediaIds, expectedWarnings, expectedSummary }) => {
      await db('attachments').insert(
        mediaIds.map((mediaId, index) => ({
          id: `att-${index + 1}`,
          statusId: 'status-1',
          actorId: 'https://llun.test/users/test',
          mediaId,
          mediaType: 'image/jpeg',
          url: `https://llun.test/api/v1/files/medias/${index}.jpg`,
          blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4',
          thumbnailUrl: `/api/v1/files/medias/${index}-thumbnail.jpg`
        }))
      )

      const mockStorage = { getFile: vi.fn().mockResolvedValue(null) } as never
      await backfillAttachments(
        db,
        mockStorage,
        options({ batchSize: 1 }),
        HOSTS
      )

      for (const expectedWarning of expectedWarnings) {
        expect(console.warn).toHaveBeenCalledWith(
          expect.stringContaining(expectedWarning)
        )
      }
      expect(console.log).toHaveBeenCalledWith(expectedSummary)
    }
  )

  // `options.batchSize` bounds the SELECT, and nothing observed the paging. At
  // fixture scale one 50-row batch and several 1-row batches produce identical
  // writes, identical warnings and identical counters — the accumulation case
  // above runs at a batch size of one on two rows and passes either way — so
  // hardcoding the limit was invisible to the whole file. Counting the SELECTs
  // is what tells the two apart.
  it('pages the attachment scan at the requested batch size', async () => {
    await db('attachments').insert(
      [1, 2, 3].map((index) => ({
        id: `att-${index}`,
        statusId: 'status-1',
        actorId: 'https://remote.example/users/them',
        mediaId: null,
        // Not an image, so no row reaches the analysis fallback and the sweep
        // is nothing but the paging under test.
        mediaType: 'video/mp4',
        url: 'https://remote.example/media/clip.mp4',
        blurhash: null
      }))
    )

    // `limit` is what narrows this to the PAGING query. Matching every SELECT
    // against the table counts any other one the loop might later issue — a
    // per-batch diagnostic count inflated this to 8 — while a limit clause is
    // exactly what the assertion is about, and a mutation that drops `.limit()`
    // altogether still fails, on zero matches rather than four.
    const selects: string[] = []
    db.on('query', ({ sql }: { sql: string }) => {
      if (
        sql.startsWith('select') &&
        sql.includes('attachments') &&
        sql.includes('limit')
      ) {
        selects.push(sql)
      }
    })

    const mockStorage = { getFile: vi.fn().mockResolvedValue(null) } as never
    await backfillAttachments(db, mockStorage, options({ batchSize: 1 }), HOSTS)

    // One SELECT per row, plus the empty one that ends the loop. A limit that
    // ignores the option reads all three rows in a single batch and stops at
    // two.
    expect(selects).toHaveLength(4)
  })

  // If you extend the paging coverage: a mutation that stops `lastId` advancing
  // does not fail, it HANGS well past the 30s `testTimeout`. better-sqlite3 is
  // a synchronous driver, so the awaits inside the sweep's `while (true)`
  // settle on the microtask queue and the loop never yields to the timer phase
  // the watchdog lives in. Kill such a run rather than waiting it out.

  // The summary is a SUMMARY: one line, after the batch loop. Every other
  // assertion on it is `toHaveBeenCalledWith`, which asks only whether the line
  // was ever logged — and the last row carries the correct cumulative totals —
  // so moving the log into either loop passed. Two rows at a batch size of one
  // separate all three placements: per row and per batch each log twice.
  it('logs the attachments summary once, as the last line of the sweep', async () => {
    await db('attachments').insert(
      [1, 2].map((index) => ({
        id: `att-${index}`,
        statusId: 'status-1',
        actorId: 'https://remote.example/users/them',
        mediaId: null,
        mediaType: 'video/mp4',
        url: 'https://remote.example/media/clip.mp4',
        blurhash: null
      }))
    )

    const mockStorage = { getFile: vi.fn().mockResolvedValue(null) } as never
    await backfillAttachments(db, mockStorage, options({ batchSize: 1 }), HOSTS)

    const expectedSummary =
      'Attachments complete: processed 2, updated 0, 0 whose media row is gone, 0 with an invalid mediaId'
    const logged = vi
      .mocked(console.log)
      .mock.calls.map((call) => String(call[0]))
    expect(
      logged.filter((line) => line.startsWith('Attachments complete:'))
    ).toEqual([expectedSummary])
    expect(logged.at(-1)).toBe(expectedSummary)
  })

  // A NULL `mediaId` is how a federated attachment is stored — there is no
  // media row to miss — so both counts have to stay at zero or every remote
  // attachment on the instance reads as a gap.
  it('counts neither cause for a federated attachment', async () => {
    await db('attachments').insert({
      id: 'att-1',
      statusId: 'status-1',
      actorId: 'https://remote.example/users/them',
      mediaId: null,
      mediaType: 'video/mp4',
      url: 'https://remote.example/media/clip.mp4',
      blurhash: null
    })

    const mockStorage = { getFile: vi.fn().mockResolvedValue(null) } as never
    await backfillAttachments(db, mockStorage, options({ force: true }), HOSTS)

    expect(console.log).toHaveBeenCalledWith(
      'Attachments complete: processed 1, updated 0, 0 whose media row is gone, 0 with an invalid mediaId'
    )
  })

  it('runs a remote attachment URL through the download guard by default', async () => {
    vi.mocked(safeImageFetch).mockResolvedValue(null)

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

    expect(safeImageFetch).toHaveBeenCalledWith(
      'https://remote.example/media/photo.jpg'
    )
  })

  // A guard on the fixture rather than on the script, placed last so it runs
  // after the tests that dirty these mocks — `beforeEach` reruns regardless, so
  // placement is what gives the guard a failing case rather than a passing one.
  // The leak it guards: `vi.restoreAllMocks()` never reaches a `vi.fn()` a
  // `vi.mock` factory created, so without the reset above these two carry their
  // implementation and their call history across the whole block, and two tests
  // here used to work around that with a local `mockReset()`. Nothing depended
  // on the leak, but a test written against either mock's DEFAULT behaviour
  // would silently inherit a neighbour's. `sequence.shuffle` is not configured;
  // a shuffled run degrades this to a vacuous pass, never a false failure.
  it('starts every test with the module mocks reset', () => {
    expect(vi.mocked(analyzeImageBuffer).mock.calls).toHaveLength(0)
    expect(
      vi.mocked(analyzeImageBuffer).getMockImplementation()
    ).toBeUndefined()
    expect(vi.mocked(safeImageFetch).mock.calls).toHaveLength(0)
    expect(vi.mocked(safeImageFetch).getMockImplementation()).toBeUndefined()
  })
})

describe('getFileBuffer', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the buffer a storage driver hands back directly', async () => {
    const storage = {
      getFile: vi
        .fn()
        .mockResolvedValue({ type: 'buffer', buffer: Buffer.from([7, 8]) })
    } as never

    const buffer = await getFileBuffer(storage, 'medias/a.jpg')
    expect(buffer && [...buffer]).toEqual([7, 8])
  })

  it('returns null when the file is missing from storage', async () => {
    const storage = { getFile: vi.fn().mockResolvedValue(null) } as never
    expect(await getFileBuffer(storage, 'medias/a.jpg')).toBeNull()
  })

  // The S3 driver answers with a redirect to the configured CDN when one is
  // set, so this branch is the only way an object-storage deployment reads a
  // file at all — deleting it whole used to pass every test.
  it('follows a storage redirect and returns the bytes', async () => {
    const storage = {
      getFile: vi.fn().mockResolvedValue({
        type: 'redirect',
        redirectUrl: 'https://cdn.example/medias/a.jpg'
      })
    } as never
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([4, 5, 6]))
    )

    const buffer = await getFileBuffer(storage, 'medias/a.jpg')
    expect(buffer && [...buffer]).toEqual([4, 5, 6])
  })

  it('refuses to follow a redirect away from the storage URL', async () => {
    const storage = {
      getFile: vi.fn().mockResolvedValue({
        type: 'redirect',
        redirectUrl: 'https://cdn.example/medias/a.jpg'
      })
    } as never
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new Uint8Array([1])))

    await getFileBuffer(storage, 'medias/a.jpg')
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://cdn.example/medias/a.jpg',
      expect.objectContaining({ redirect: 'error' })
    )
  })

  it('returns null when the storage redirect answers non-ok', async () => {
    const storage = {
      getFile: vi.fn().mockResolvedValue({
        type: 'redirect',
        redirectUrl: 'https://cdn.example/medias/a.jpg'
      })
    } as never
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('missing', { status: 404 })
    )

    expect(await getFileBuffer(storage, 'medias/a.jpg')).toBeNull()
  })

  // `PRESIGNED_ANALYSIS_MAX_BYTES` is 50 MB; a body past it must raise rather
  // than be buffered whole.
  //
  // The oversize is DECLARED in `content-length` rather than materialised:
  // `readResponseArrayBufferWithLimit` refuses on the header before reading a
  // byte, and an actual 51 MB body made the mutation that removes the cap OOM
  // the whole Vitest worker — which in CI reads as infrastructure flakiness
  // rather than as this guard regressing.
  it('refuses a stored file that declares a size past the cap', async () => {
    const storage = {
      getFile: vi.fn().mockResolvedValue({
        type: 'redirect',
        redirectUrl: 'https://cdn.example/huge.jpg'
      })
    } as never
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'content-length': String(51 * 1024 * 1024) }
      })
    )

    await expect(getFileBuffer(storage, 'huge.jpg')).rejects.toThrow(
      /exceeds byte limit/
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

  // `--dry-run` is the first command `docs/maintenance.md` tells an operator to
  // run, and nothing exercised this half of the gate — collapsing it to an
  // unconditional write passed the whole file. The row has to be one that
  // genuinely diverges, or the update block is never reached and "without
  // writing" asserts nothing; the `backfillAttachments` case is the model.
  it('counts a media row it would write under --dry-run without writing it', async () => {
    await insertMedia({ blurhash: null, focusX: null, focusY: null })
    vi.mocked(analyzeImageBuffer).mockResolvedValue({
      blurhash: 'FRESHHASH',
      focus: { x: 0.5, y: -0.25 }
    })

    await backfillMedias(db, storage(), options({ dryRun: true }))

    const untouched = await db('medias').where('id', 1).first()
    expect(untouched.blurhash).toBeNull()
    expect(untouched.focusX).toBeNull()
    expect(untouched.focusY).toBeNull()

    const logged = vi
      .mocked(console.log)
      .mock.calls.map((call) => String(call[0]))
    expect(logged).toContain(
      '[DRY RUN] [medias 1] would update {"blurhash":"FRESHHASH","focusX":0.5,"focusY":-0.25}'
    )
    // `totalUpdated` deliberately counts what WOULD be written, so the summary
    // still reports the size of the pending repair.
    expect(logged).toContain('Medias complete: processed 1, updated 1')
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
