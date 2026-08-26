import { readFileSync } from 'fs'
import fs from 'fs/promises'
import fetchMock from 'jest-fetch-mock'
import os from 'os'
import path from 'path'

import { NOTE_ACTIVITY_CONTEXT } from '@/lib/activities/noteContext'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { MAX_FEDERATION_MEDIA_ATTACHMENTS } from '@/lib/services/mastodon/constants'
import { MAX_FILE_SIZE } from '@/lib/services/medias/constants'
import { Attachment } from '@/lib/types/domain/attachment'
import { Status, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { safeImageFetch } from '@/lib/utils/safeImageDownload'

import {
  REMOTE_ATTACHMENT_FETCH_TIMEOUT_MS,
  buildActorJson,
  buildExportActivity,
  buildFollowersCsv,
  buildFollowingCsv,
  buildRemoteFetchBudgetWarning,
  copyProfileImage,
  createOrderedCollectionWriter,
  csvEscape,
  forEachActorStatus,
  forEachFitnessFile,
  forEachLike,
  getArchiveFitnessPath,
  getArchiveMediaPath,
  parseExportActorArgs,
  registerAttachmentUrl
} from './actorArchive'

// A spy that CALLS THROUGH: the refusal tests below must exercise the real
// address policy — a mock would prove only the wiring and would still pass
// against a plain `fetch`. This only makes the call arguments assertable.
vi.mock('@/lib/utils/safeImageDownload', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/utils/safeImageDownload')>()
  return { ...actual, safeImageFetch: vi.fn(actual.safeImageFetch) }
})

const buildAttachment = (overrides: Partial<Attachment> = {}): Attachment => ({
  id: 'attachment-1',
  actorId: 'https://example.test/users/alice',
  statusId: 'status-1',
  type: 'Document',
  mediaType: 'image/jpeg',
  url: 'https://example.test/api/v1/files/ab/cd.webp',
  name: 'a photo',
  createdAt: 1,
  updatedAt: 1,
  ...overrides
})

const buildStatus = (overrides: Partial<Status> = {}): Status =>
  ({
    id: 'https://example.test/users/alice/statuses/1',
    actorId: 'https://example.test/users/alice',
    actor: null,

    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [],
    edits: [],

    isLocalActor: true,
    createdAt: 1,
    updatedAt: 1,

    type: StatusType.enum.Note,
    url: 'https://example.test/@alice/1',
    text: 'hello world',
    reply: '',
    replies: [],

    actorAnnounceStatusId: null,
    isActorLiked: false,
    isActorBookmarked: false,
    totalLikes: 0,
    totalShares: 0,

    attachments: [],
    tags: [],

    ...overrides
  }) as Status

describe('parseExportActorArgs', () => {
  it('throws when no actor selector is given', () => {
    expect(() => parseExportActorArgs([])).toThrow()
  })

  it('throws when more than one actor selector is given', () => {
    expect(() =>
      parseExportActorArgs(['--username', 'alice', '--email', 'a@example.test'])
    ).toThrow()
  })

  it('applies defaults for a bare --username selector', () => {
    const args = parseExportActorArgs(['--username', 'alice'])
    expect(args).toMatchObject({
      username: 'alice',
      domain: undefined,
      actorId: undefined,
      email: undefined,
      envFile: '.env.production',
      outputDir: 'backups/actor-archives',
      pageSize: 100,
      allowMissingStorage: false,
      skipStorage: false,
      fetchRemoteAttachments: false,
      remoteFetchBudgetSeconds: 3600
    })
  })

  it('parses --key=value form and boolean flags', () => {
    const args = parseExportActorArgs([
      '--actor-id=https://example.test/users/alice',
      '--page-size=25',
      '--allow-missing-storage',
      '--skip-storage',
      '--fetch-remote-attachments',
      '--remote-fetch-budget=900'
    ])
    expect(args).toMatchObject({
      actorId: 'https://example.test/users/alice',
      pageSize: 25,
      allowMissingStorage: true,
      skipStorage: true,
      fetchRemoteAttachments: true,
      remoteFetchBudgetSeconds: 900
    })
  })

  it('throws on a non-numeric --page-size', () => {
    expect(() =>
      parseExportActorArgs(['--username', 'alice', '--page-size', 'nope'])
    ).toThrow()
  })

  // Zero is the interesting row: it is a live budget meaning "start nothing",
  // so reading it as "unbounded" would restore the very stall this bounds.
  it.each([
    { description: 'a non-numeric value', value: 'nope' },
    { description: 'zero', value: '0' },
    { description: 'a negative value', value: '-1' },
    { description: 'a fractional value', value: '1.5' }
  ])('throws on $description for --remote-fetch-budget', ({ value }) => {
    expect(() =>
      parseExportActorArgs([
        '--username',
        'alice',
        '--remote-fetch-budget',
        value
      ])
    ).toThrow(/--remote-fetch-budget/)
  })
})

describe('registerAttachmentUrl', () => {
  const hostConfig = { host: 'example.test', trustedHosts: ['alias.example'] }

  // The cap is a parameter, not a module constant, so a test can pin a tiny
  // one and stream a real body past it — the streaming accumulator is
  // unreachable at a realistic 200 MiB cap.
  const runRegister = async ({
    attachment,
    fetchRemoteAttachments = false,
    maxAttachmentBytes = MAX_FILE_SIZE,
    // Far enough ahead that every test which is not about the budget is
    // unaffected by it.
    deadline = Date.now() + 60_000,
    stagingDir = '/nonexistent'
  }: {
    attachment: Attachment
    fetchRemoteAttachments?: boolean
    maxAttachmentBytes?: number
    deadline?: number
    stagingDir?: string
  }) => {
    const remoteFetch = fetchRemoteAttachments
      ? { maxBytes: maxAttachmentBytes, deadline }
      : null
    const mediaPaths = new Set<string>()
    const mediaIds = new Set<string>()
    const urlToArchivePath = new Map<string, string>()
    const warnings: string[] = []

    const result = await registerAttachmentUrl({
      attachment,
      hostConfig,
      mediaPaths,
      mediaIds,
      remoteFetch,
      urlToArchivePath,
      stagingDir,
      warnings
    })

    return { mediaPaths, mediaIds, urlToArchivePath, result, warnings }
  }

  // `vitest.setup.ts` enables the fetch mock but leaves it passing through, so
  // the tests that reach the download branch opt in with `doMock()`. One
  // teardown covers all of them, including a later one that opts in without
  // cleaning up after itself.
  afterEach(() => {
    fetchMock.resetMocks()
    fetchMock.dontMock()
  })

  it.each([
    {
      description: 'the configured host',
      url: 'https://example.test/api/v1/files/ab/cd.webp'
    },
    {
      description: 'a trusted host',
      url: 'https://alias.example/api/v1/files/ab/cd.webp'
    }
  ])('archives an attachment stored on $description', async ({ url }) => {
    const { mediaPaths, mediaIds, urlToArchivePath, warnings } =
      await runRegister({
        attachment: buildAttachment({ url, mediaId: 'media-1' })
      })

    expect([...mediaPaths]).toEqual(['ab/cd.webp'])
    expect([...mediaIds]).toEqual(['media-1'])
    expect(urlToArchivePath.get(url)).toBe('media_attachments/files/ab/cd.webp')
    expect(warnings).toEqual([])
  })

  // `/api/v1/files/` is this project's own route, so every OTHER
  // activities.next instance serves attachment URLs under exactly that path.
  // Reading one as a local storage path put a file the archive never contains
  // into the manifest and skipped the download branch below.
  it('does not treat another instance media URL as a stored path', async () => {
    const url = 'https://other.example/api/v1/files/ab/cd.webp'
    const { mediaPaths, mediaIds, urlToArchivePath, warnings } =
      await runRegister({ attachment: buildAttachment({ url }) })

    expect([...mediaPaths]).toEqual([])
    expect([...mediaIds]).toEqual([])
    expect(urlToArchivePath.has(url)).toBe(false)
    expect(warnings).toEqual([`Remote attachment kept as absolute URL: ${url}`])
  })

  it('downloads another instance media URL when asked to fetch remotes', async () => {
    const url = 'https://other.example/api/v1/files/ab/cd.webp'
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'actor-archive-remote-test-')
    )

    fetchMock.doMock()
    fetchMock.mockResponseOnce('remote-bytes', { status: 200 })

    try {
      const { mediaPaths, urlToArchivePath, warnings } = await runRegister({
        attachment: buildAttachment({ url }),
        fetchRemoteAttachments: true,
        stagingDir: dir
      })

      expect([...mediaPaths]).toEqual([])
      expect(warnings).toEqual([])

      const relativePath = urlToArchivePath.get(url)
      expect(relativePath).toMatch(
        /^media_attachments\/remote\/[0-9a-f]{16}\.webp$/
      )
      expect(await fs.readFile(path.join(dir, relativePath!), 'utf-8')).toBe(
        'remote-bytes'
      )
    } finally {
      await fs.rm(dir, { force: true, recursive: true })
    }
  })

  it('does not re-register a URL already resolved to an archive path', async () => {
    // `mediaPaths`/`mediaIds` are Sets, so adding the same value twice is
    // invisible either way — use a different `mediaId` per call so a second,
    // non-memoized registration would show up as a second Set entry.
    const url = 'https://example.test/api/v1/files/ab/cd.webp'
    const mediaPaths = new Set<string>()
    const mediaIds = new Set<string>()
    const urlToArchivePath = new Map<string, string>()
    const warnings: string[] = []
    // Not `runRegister`: this needs the same collections across both calls,
    // and that helper allocates a fresh set of them per call.
    const register = (mediaId: string) =>
      registerAttachmentUrl({
        attachment: buildAttachment({ url, mediaId }),
        hostConfig,
        mediaPaths,
        mediaIds,
        remoteFetch: null,
        urlToArchivePath,
        stagingDir: '/nonexistent',
        warnings
      })

    await register('media-1')
    await register('media-2')

    expect([...mediaIds]).toEqual(['media-1'])
    expect([...mediaPaths]).toEqual(['ab/cd.webp'])
    expect(warnings).toEqual([])
  })

  it.each([
    {
      description: 'a non-OK HTTP response',
      setupMock: () => fetchMock.mockResponseOnce('', { status: 404 }),
      expectedMessage: 'HTTP 404'
    },
    {
      description: 'a rejected fetch',
      setupMock: () => fetchMock.mockRejectOnce(new Error('network fail')),
      expectedMessage: 'network fail'
    }
  ])(
    'warns and leaves no archive path when fetching a remote attachment fails on $description',
    async ({ setupMock, expectedMessage }) => {
      const url = 'https://other.example/api/v1/files/ab/cd.webp'

      fetchMock.doMock()
      setupMock()

      const { mediaPaths, urlToArchivePath, warnings } = await runRegister({
        attachment: buildAttachment({ url }),
        fetchRemoteAttachments: true
      })

      expect([...mediaPaths]).toEqual([])
      expect(urlToArchivePath.has(url)).toBe(false)
      expect(warnings).toEqual([
        `Failed to fetch remote attachment ${url}: ${expectedMessage}`
      ])
    }
  )

  // The non-OK branch drains the body before throwing. Nothing else asserts
  // it: the streamLimit tests cover the byte-cap refusal paths, which are
  // different code. Left undrained, a host answering every request with an
  // error holds one connection per attachment until the deadline fires.
  //
  // This is the one test that stubs `safeImageFetch` outright rather than
  // calling through, because it needs a body whose `cancel` it can observe.
  it('drains the body of a non-OK remote attachment response', async () => {
    const url = 'https://other.example/api/v1/files/ab/notfound.webp'
    const cancel = vi.fn().mockResolvedValue(undefined)

    vi.mocked(safeImageFetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      body: { cancel }
    } as unknown as Response)

    const { urlToArchivePath, warnings } = await runRegister({
      attachment: buildAttachment({ url }),
      fetchRemoteAttachments: true
    })

    expect(cancel).toHaveBeenCalled()
    expect(urlToArchivePath.has(url)).toBe(false)
    expect(warnings).toEqual([
      `Failed to fetch remote attachment ${url}: HTTP 404`
    ])
  })

  // `attachment.url` is whatever the account owner put on the status:
  // `POST /api/v1/accounts/outbox` takes `PostBoxAttachment.url` as a bare
  // `z.string()` and `createAttachment` writes it verbatim. Without a guard,
  // `--fetch-remote-attachments` turned that into an outbound request from the
  // machine running the export, with the response body written into the
  // tarball the owner receives.
  //
  // These go through the REAL `safeImageFetch`, not a mock, so a revert of the
  // guard fails them. None of them reaches DNS: the three IP literals take the
  // `isIP` branch, `localhost` is caught by the hostname-name check before the
  // lookup, and the `http://` row is refused on protocol before the hostname
  // is parsed at all. The global `node:dns/promises` mock in `vitest.setup.ts`
  // (every hostname resolves to the public 93.184.216.34) is what keeps the
  // hostname-based tests ABOVE reaching the mocked network — not these.
  it.each([
    {
      description: 'the cloud metadata address',
      url: 'https://169.254.169.254/latest/meta-data/iam/x.webp'
    },
    {
      description: 'a loopback address',
      url: 'https://127.0.0.1/api/v1/files/ab/cd.webp'
    },
    {
      description: 'a private network address',
      url: 'https://10.0.0.5/api/v1/files/ab/cd.webp'
    },
    {
      description: 'a localhost name',
      url: 'https://localhost/api/v1/files/ab/cd.webp'
    },
    {
      description: 'a plain HTTP URL',
      url: 'http://other.example/api/v1/files/ab/cd.webp'
    }
  ])(
    'refuses to fetch a remote attachment on $description',
    async ({ url }) => {
      fetchMock.doMock()

      const { mediaPaths, urlToArchivePath, warnings } = await runRegister({
        attachment: buildAttachment({ url }),
        fetchRemoteAttachments: true
      })

      expect(fetchMock).not.toHaveBeenCalled()
      expect([...mediaPaths]).toEqual([])
      expect(urlToArchivePath.has(url)).toBe(false)
      expect(warnings).toEqual([
        `Refused remote attachment URL (unsafe address, non-HTTPS, or too many redirects): ${url}`
      ])
    }
  )

  // Three cases, because `readResponseArrayBufferWithLimit` has two
  // independent refusal paths and the declared-length one alone is worth
  // little: a hostile host simply omits or understates `content-length`, so
  // the streaming accumulator gets both of those shapes. Proved distinct by
  // disabling only the header short-circuit — the streamed case still fails,
  // the declared-length case stops failing.
  it.each([
    {
      description: 'a declared content-length over the cap',
      // Small real body, huge declared length: only the header is consulted.
      buildResponse: (maxAttachmentBytes: number) => ({
        body: 'x'.repeat(8),
        headers: { 'content-length': String(maxAttachmentBytes + 1) },
        status: 200
      })
    },
    {
      description: 'a streamed body over the cap with no content-length',
      // No declared length at all, so the byte accumulator is the only thing
      // standing between a hostile host and an unbounded read.
      buildResponse: (maxAttachmentBytes: number) => ({
        body: 'x'.repeat(maxAttachmentBytes * 4),
        status: 200
      })
    },
    {
      description: 'a streamed body over the cap understating content-length',
      buildResponse: (maxAttachmentBytes: number) => ({
        body: 'x'.repeat(maxAttachmentBytes * 4),
        headers: { 'content-length': '8' },
        status: 200
      })
    }
  ])(
    'refuses a remote attachment exceeding the byte cap on $description',
    async ({ buildResponse }) => {
      const maxAttachmentBytes = 64
      const url = 'https://other.example/api/v1/files/ab/huge.webp'
      const dir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'actor-archive-oversize-test-')
      )

      fetchMock.doMock()
      fetchMock.mockResponseOnce(() =>
        Promise.resolve(buildResponse(maxAttachmentBytes))
      )

      try {
        const { urlToArchivePath, warnings } = await runRegister({
          attachment: buildAttachment({ url }),
          fetchRemoteAttachments: true,
          maxAttachmentBytes,
          stagingDir: dir
        })

        expect(urlToArchivePath.has(url)).toBe(false)
        expect(warnings).toEqual([
          `Failed to fetch remote attachment ${url}: Remote attachment exceeds byte limit of ${maxAttachmentBytes} bytes`
        ])
        await expect(
          fs.readdir(path.join(dir, 'media_attachments', 'remote'))
        ).rejects.toThrow()
      } finally {
        await fs.rm(dir, { force: true, recursive: true })
      }
    }
  )

  // Nothing about the timeout is visible in a result, so a revert to the old
  // 60s — which bounded the body read and silently dropped large attachments —
  // passed every other test in this file. Same for the overall deadline: drop
  // it and each hop simply restarts the clock.
  it('bounds a remote attachment fetch by both a per-hop timeout and an overall deadline', async () => {
    // A URL unique to this test, and a cleared spy: the shared spy accumulates
    // across the file, and an earlier test issues an identical call — so
    // without both, this assertion is satisfied by residue and passes even if
    // its own subject never runs.
    const url = 'https://other.example/api/v1/files/ab/deadline.webp'
    vi.mocked(safeImageFetch).mockClear()

    fetchMock.doMock()
    fetchMock.mockResponseOnce('remote-bytes', { status: 200 })

    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'actor-archive-timeout-test-')
    )
    try {
      await runRegister({
        attachment: buildAttachment({ url }),
        fetchRemoteAttachments: true,
        stagingDir: dir
      })

      expect(vi.mocked(safeImageFetch)).toHaveBeenCalledWith(url, {
        timeoutMs: REMOTE_ATTACHMENT_FETCH_TIMEOUT_MS,
        signal: expect.any(AbortSignal)
      })
    } finally {
      await fs.rm(dir, { force: true, recursive: true })
    }
  })

  // The per-attachment deadline above bounds ONE attachment; these bound the
  // export. Ten minutes times an actor's whole history is still days, and the
  // URLs are owner-supplied, so a run started because of a ban or a legal
  // request is exactly the one an owner has an interest in stalling.
  it('keeps a remote attachment as an absolute URL once the fetch budget is exhausted', async () => {
    const url = 'https://other.example/api/v1/files/ab/late.webp'
    // Mocked and armed with a usable response on purpose: the assertions below
    // have to fail loudly if the download happens anyway, rather than passing
    // because the network was unreachable.
    fetchMock.doMock()
    fetchMock.mockResponse('remote-bytes', { status: 200 })
    vi.mocked(safeImageFetch).mockClear()

    const { mediaPaths, urlToArchivePath, result, warnings } =
      await runRegister({
        attachment: buildAttachment({ url }),
        fetchRemoteAttachments: true,
        deadline: Date.now() - 1
      })

    // Not merely "no bytes written": the guard has to run before the request
    // is issued, so that a hostile host is never given a connection to stall.
    expect(vi.mocked(safeImageFetch)).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect([...mediaPaths]).toEqual([])
    // No archive path, so `resolveArchivePath` falls back to the URL itself —
    // the same outcome as never passing `--fetch-remote-attachments`.
    expect(urlToArchivePath.has(url)).toBe(false)
    expect(result).toEqual({ budgetExhausted: true })
    expect(warnings).toEqual([
      `Remote attachment fetch budget exhausted, kept as absolute URL: ${url}`
    ])
  })

  // Ordering, and the reason the check sits below the local-storage branch: a
  // path this instance already holds costs no network, so an exhausted budget
  // must not start dropping the actor's OWN media from their archive.
  it('still archives a locally stored attachment once the fetch budget is exhausted', async () => {
    const url = 'https://example.test/api/v1/files/ab/cd.webp'

    const { mediaPaths, mediaIds, urlToArchivePath, result, warnings } =
      await runRegister({
        attachment: buildAttachment({ url, mediaId: 'media-1' }),
        fetchRemoteAttachments: true,
        deadline: Date.now() - 1
      })

    expect([...mediaPaths]).toEqual(['ab/cd.webp'])
    expect([...mediaIds]).toEqual(['media-1'])
    expect(urlToArchivePath.get(url)).toBe('media_attachments/files/ab/cd.webp')
    expect(result).toEqual({})
    expect(warnings).toEqual([])
  })

  // The half that makes the budget safe to have at all. An aggregate bound
  // implemented as an abort — the shape that WOULD trade a stall for silent
  // data loss — passes the two tests above and fails this one.
  it('completes a download already in flight when the budget expires, and starts no more', async () => {
    const started = 'https://other.example/api/v1/files/ab/started.webp'
    const later = 'https://other.example/api/v1/files/ab/later.webp'
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'actor-archive-budget-test-')
    )

    // The clock is offset rather than frozen, so it still advances normally
    // and nothing else in the stack sees time stand still. The mocked response
    // jumps that offset past the deadline WHILE the first download is running,
    // which is the moment the guard has to get right — driving it by hand
    // rather than by real elapsed time is what keeps this from being a race.
    const realNow = Date.now.bind(Date)
    const deadline = realNow() + 60_000
    let offsetMs = 0
    const nowSpy = vi
      .spyOn(Date, 'now')
      .mockImplementation(() => realNow() + offsetMs)

    fetchMock.doMock()
    fetchMock.mockResponse(() => {
      offsetMs = 120_000
      return Promise.resolve({ body: 'remote-bytes', status: 200 })
    })

    const mediaPaths = new Set<string>()
    const mediaIds = new Set<string>()
    const urlToArchivePath = new Map<string, string>()
    const warnings: string[] = []
    // Not `runRegister`: both calls have to share one budget, and that helper
    // allocates a fresh one per call.
    const register = (url: string) =>
      registerAttachmentUrl({
        attachment: buildAttachment({ url }),
        hostConfig,
        mediaPaths,
        mediaIds,
        remoteFetch: { maxBytes: MAX_FILE_SIZE, deadline },
        urlToArchivePath,
        stagingDir: dir,
        warnings
      })

    try {
      const first = await register(started)
      expect(Date.now()).toBeGreaterThan(deadline)
      const second = await register(later)

      expect(first).toEqual({})
      const relativePath = urlToArchivePath.get(started)
      expect(relativePath).toMatch(
        /^media_attachments\/remote\/[0-9a-f]{16}\.webp$/
      )
      expect(await fs.readFile(path.join(dir, relativePath!), 'utf-8')).toBe(
        'remote-bytes'
      )

      expect(second).toEqual({ budgetExhausted: true })
      expect(urlToArchivePath.has(later)).toBe(false)
      expect(warnings).toEqual([
        `Remote attachment fetch budget exhausted, kept as absolute URL: ${later}`
      ])
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      nowSpy.mockRestore()
      await fs.rm(dir, { force: true, recursive: true })
    }
  })
})

describe('copyProfileImage', () => {
  // The archive root sits inside a wider temp root so a traversal out of it
  // has somewhere real to land: `media_attachments/files` is two levels below
  // the staging directory, so `../../../secrets/env` resolves to a file the
  // archive must never contain.
  const withArchiveRoot = async (
    run: (paths: { stagingDir: string; secretPath: string }) => Promise<void>
  ) => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), 'actor-archive-profile-test-')
    )
    const stagingDir = path.join(root, 'staging')
    const secretPath = path.join(root, 'secrets', 'env')

    try {
      await fs.mkdir(stagingDir, { recursive: true })
      await fs.mkdir(path.dirname(secretPath), { recursive: true })
      await fs.writeFile(secretPath, 'ACTIVITIES_SECRET=hunter2')
      await run({ stagingDir, secretPath })
    } finally {
      await fs.rm(root, { force: true, recursive: true })
    }
  }

  it('copies a profile image stored inside the archive media directory', async () => {
    await withArchiveRoot(async ({ stagingDir }) => {
      const source = path.join(stagingDir, getArchiveMediaPath('ab/cd.webp'))
      await fs.mkdir(path.dirname(source), { recursive: true })
      await fs.writeFile(source, 'avatar-bytes')

      const warnings: string[] = []
      const fileName = await copyProfileImage({
        stagingDir,
        storagePath: 'ab/cd.webp',
        fileNamePrefix: 'avatar',
        warnings
      })

      expect(fileName).toBe('avatar.webp')
      expect(
        await fs.readFile(path.join(stagingDir, 'avatar.webp'), 'utf-8')
      ).toBe('avatar-bytes')
      expect(warnings).toEqual([])
    })
  })

  // `getMediaPathFromFileUrl` refuses a `..` segment before one can reach
  // here, but this is the step that turns a stored path into a file read off
  // the operator's machine, so it answers the question for itself.
  it.each([
    {
      description: 'traverses out of the media dir',
      buildStoragePath: () => '../../../secrets/env'
    },
    {
      description: 'is exactly one level up',
      buildStoragePath: () => '..'
    },
    {
      description: 'is absolute and outside',
      buildStoragePath: (secretPath: string) => secretPath
    }
  ])(
    'refuses a profile image whose stored path $description',
    async ({ buildStoragePath }) => {
      await withArchiveRoot(async ({ stagingDir, secretPath }) => {
        const storagePath = buildStoragePath(secretPath)
        const warnings: string[] = []

        const fileName = await copyProfileImage({
          stagingDir,
          storagePath,
          fileNamePrefix: 'avatar',
          warnings
        })

        expect(fileName).toBeNull()
        expect(warnings).toEqual([
          `Refused avatar image path outside the archive media directory: ${storagePath}`
        ])
        // The assertion that matters: the secret was not read into the archive
        // under the `.bin` fallback name an extension-less path produces.
        await expect(
          fs.readFile(path.join(stagingDir, 'avatar.bin'), 'utf-8')
        ).rejects.toThrow()
      })
    }
  )

  it('warns without copying when the stored path names no file', async () => {
    await withArchiveRoot(async ({ stagingDir }) => {
      const warnings: string[] = []

      const fileName = await copyProfileImage({
        stagingDir,
        storagePath: 'ab/missing.webp',
        fileNamePrefix: 'header',
        warnings
      })

      expect(fileName).toBeNull()
      expect(warnings).toEqual([
        'Could not copy header image from storage: ab/missing.webp'
      ])
    })
  })

  it('returns null without warning when there is no stored path', async () => {
    const warnings: string[] = []
    expect(
      await copyProfileImage({
        stagingDir: '/nonexistent',
        storagePath: null,
        fileNamePrefix: 'avatar',
        warnings
      })
    ).toBeNull()
    expect(warnings).toEqual([])
  })
})

// `exportActorArchive` resolves the remote-attachment byte cap from the
// `media.maxFileSize` server setting and threads it into
// `registerAttachmentUrl`. Reverting that to the compile-time `MAX_FILE_SIZE`
// constant is INVISIBLE to every test above: the cap arrives as a parameter, so
// those tests pass whatever they like and still pass, and nothing drives
// `exportActorArchive` end to end (it wants a database, a staging directory and
// a tar writer).
//
// The revert is not hypothetical — it is what the first version of this code
// did, and it refused remote attachments this instance's own upload path would
// have accepted, because `MAX_FILE_SIZE` is only the DEFAULT for a setting an
// admin may raise to `MAX_CONFIGURABLE_FILE_SIZE` (1 GiB).
//
// Both assertions are deliberately formatting-independent: an earlier version
// matched the exact shape of the ternary, which prettier could rewrite for
// reasons having nothing to do with behaviour.
describe('actor archive remote attachment cap', () => {
  const SOURCE = readFileSync(
    path.join(process.cwd(), 'scripts', 'backup', 'actorArchive.ts'),
    'utf-8'
  )

  it('resolves the cap from the media.maxFileSize server setting', () => {
    // Asserting the call is PRESENT is not enough — it must be the thing
    // assigned. A revert can keep the call and discard its result
    // (`(await getMaxMediaUploadSize(database), 10 * 1024 * 1024)`), which
    // hardcodes a cap while looking correct to a presence check. Matching the
    // assignment is still formatting-tolerant: `\s*` absorbs a prettier wrap.
    // Anchored on the closing brace: `toMatch` is a substring search, so
    // without it anything appended to the call survives — `await
    // getMaxMediaUploadSize(database) / 100`, the sort of "leave headroom"
    // arithmetic someone adds without meaning to revert anything, would make
    // the effective cap 1% of the setting and still match.
    expect(SOURCE).toMatch(
      /maxBytes:\s*await getMaxMediaUploadSize\(database\)\s*[,}]/
    )
  })

  // Same shape of hazard, same reason it needs a source assertion: nothing in
  // a result distinguishes a deadline stamped once for the run from one
  // recomputed per attachment, and the second is no bound at all — every
  // attachment would find the full budget ahead of it.
  //
  // WHERE it is stamped is the whole property, so asserting the expression
  // merely EXISTS proves nothing: an earlier version of this test did exactly
  // that, and moving the identical expression down into the status loop —
  // rebuilding `remoteFetch` per attachment, which hands every attachment a
  // full budget — left the whole suite green. The count pins it to one stamp,
  // and the index comparison pins that one above the loop that spends it,
  // which is the only place a per-attachment stamp could live.
  it('stamps the budget deadline once, above the status walk that spends it', () => {
    const stamps = [
      ...SOURCE.matchAll(
        /deadline:\s*Date\.now\(\)\s*\+\s*args\.remoteFetchBudgetSeconds\s*\*\s*1000\s*[,}]/g
      )
    ]
    expect(stamps).toHaveLength(1)

    // Asserted rather than assumed: were this marker renamed, `indexOf` would
    // answer -1 and the comparison below would be trivially satisfiable.
    const statusWalkIndex = SOURCE.indexOf(
      'for await (const status of forEachActorStatus'
    )
    expect(statusWalkIndex).toBeGreaterThan(0)
    expect(stamps[0].index).toBeLessThan(statusWalkIndex)
  })

  // The property that makes an aggregate bound safe in a BACKUP tool: the
  // budget may decline to start work, never cancel work already started.
  //
  // It is asserted against the source because the alternative cannot be
  // asserted deterministically. An implementation that hands the deadline to
  // `safeImageFetch` as an abort signal only misbehaves once real time
  // elapses, so catching it behaviourally would mean a test that sleeps past a
  // real deadline and races the machine it runs on. The structural property is
  // exact instead: `remoteFetch.deadline` is read once, by the start gate.
  // Wiring it into the fetch needs a second read, and replacing the gate with
  // one fails the pattern below.
  //
  // It depends on that exact spelling, so a behaviour-preserving refactor —
  // destructuring `const { deadline } = remoteFetch` above the gate — fails it
  // too. That is the price of the guard rather than a bug in it; `matchAll` is
  // used so such a failure reads as "expected [] to have length 1" instead of
  // a `TypeError` from `String.match`'s null.
  it('never turns the budget deadline into an abort signal', () => {
    expect([...SOURCE.matchAll(/remoteFetch\.deadline/g)]).toHaveLength(1)
    expect(SOURCE).toMatch(
      /if\s*\(Date\.now\(\)\s*>=\s*remoteFetch\.deadline\)/
    )
  })

  it('does not import the compile-time upload size constant', () => {
    // The brace list is matched across newlines on purpose: prettier wraps an
    // import past 80 characters, which is exactly the shape a reintroduced
    // `MAX_FILE_SIZE` would take arriving beside another symbol from the same
    // module — and a single-line-only pattern would pass straight over it.
    expect(SOURCE).not.toMatch(
      /import\s*\{[^}]*\bMAX_FILE_SIZE\b[^}]*\}\s*from '@\/lib\/services\/medias\/constants'/
    )
  })
})

describe('buildRemoteFetchBudgetWarning', () => {
  // A clean run must not carry a line saying its budget was fine — an
  // always-present warning is one an operator stops reading.
  it.each([{ skipped: 0 }, { skipped: -1 }])(
    'reports nothing when $skipped attachments were skipped',
    ({ skipped }) => {
      expect(
        buildRemoteFetchBudgetWarning({ skipped, budgetSeconds: 3600 })
      ).toBeNull()
    }
  )

  // The count and the remedy are the point of the line: the operator has to be
  // able to tell a truncated run from failed downloads, and know that
  // re-running with a larger budget is what answers it.
  it.each([
    {
      description: 'one attachment',
      skipped: 1,
      expected:
        'Remote attachment fetch budget of 900s was exhausted; ' +
        '1 remote attachment kept as absolute URLs. ' +
        'Re-run with a larger --remote-fetch-budget to fetch them.'
    },
    {
      description: 'several attachments',
      skipped: 12,
      expected:
        'Remote attachment fetch budget of 900s was exhausted; ' +
        '12 remote attachments kept as absolute URLs. ' +
        'Re-run with a larger --remote-fetch-budget to fetch them.'
    }
  ])(
    'names the count and the remedy for $description',
    ({ skipped, expected }) => {
      expect(
        buildRemoteFetchBudgetWarning({ skipped, budgetSeconds: 900 })
      ).toBe(expected)
    }
  )
})

describe('getArchiveMediaPath / getArchiveFitnessPath', () => {
  it('prefixes storage paths with the archive directory', () => {
    expect(getArchiveMediaPath('ab/cd.webp')).toBe(
      'media_attachments/files/ab/cd.webp'
    )
    expect(getArchiveFitnessPath('ab/cd.fit')).toBe(
      'fitness_files/files/ab/cd.fit'
    )
  })
})

describe('csvEscape / buildFollowingCsv / buildFollowersCsv', () => {
  it('leaves plain values untouched', () => {
    expect(csvEscape('alice@example.test')).toBe('alice@example.test')
  })

  it('quotes and escapes values containing commas or quotes', () => {
    expect(csvEscape('a "quoted", value')).toBe('"a ""quoted"", value"')
  })

  it('builds a Mastodon-import-compatible following CSV', () => {
    const csv = buildFollowingCsv([
      {
        handle: 'alice@example.test',
        showBoosts: true,
        notify: false,
        languages: null
      },
      {
        handle: 'bob@example.test',
        showBoosts: false,
        notify: true,
        languages: ['en', 'th']
      }
    ])
    expect(csv).toBe(
      'Account address,Show boosts,Notify on new posts,Languages\n' +
        'alice@example.test,true,false,\n' +
        'bob@example.test,false,true,"en, th"\n'
    )
  })

  it('builds a followers CSV with just the handle column', () => {
    const csv = buildFollowersCsv(['alice@example.test', 'bob@example.test'])
    expect(csv).toBe('Account address\nalice@example.test\nbob@example.test\n')
  })
})

describe('buildActorJson', () => {
  it('rewrites icon and image URLs to the archived file names', () => {
    const actorJson = buildActorJson({
      person: {
        id: 'https://example.test/users/alice',
        icon: { type: 'Image', mediaType: 'image/jpeg', url: 'https://old' },
        image: { type: 'Image', mediaType: 'image/png', url: 'https://old' }
      },
      avatarFileName: 'avatar.webp',
      headerFileName: 'header.webp'
    })

    expect(actorJson.icon).toEqual({
      type: 'Image',
      mediaType: 'image/jpeg',
      url: 'avatar.webp'
    })
    expect(actorJson.image).toEqual({
      type: 'Image',
      mediaType: 'image/png',
      url: 'header.webp'
    })
  })

  it('leaves icon/image untouched when no local copy exists', () => {
    const actorJson = buildActorJson({
      person: { id: 'https://example.test/users/alice' },
      avatarFileName: null,
      headerFileName: null
    })
    expect(actorJson.icon).toBeUndefined()
    expect(actorJson.image).toBeUndefined()
  })
})

describe('buildExportActivity', () => {
  const urlToArchivePath = (url: string) =>
    url === 'https://example.test/api/v1/files/ab/cd.webp'
      ? 'media_attachments/files/ab/cd.webp'
      : url

  it('shapes an Announce as a reference to the boosted status id', () => {
    const originalStatus = buildStatus({
      id: 'https://example.test/users/bob/statuses/1'
    })
    const status = buildStatus({
      id: 'https://example.test/users/alice/statuses/announce-1',
      type: StatusType.enum.Announce,
      originalStatus
    } as Partial<Status>)

    const activity = buildExportActivity({ status, urlToArchivePath })

    expect(activity).toMatchObject({
      id: status.id,
      type: 'Announce',
      object: originalStatus.id
    })
    expect(activity).not.toHaveProperty('attachment')
  })

  it('keeps every attachment, beyond the federation cap, and rewrites local URLs', () => {
    const attachments = Array.from(
      { length: MAX_FEDERATION_MEDIA_ATTACHMENTS + 1 },
      (_, index) =>
        buildAttachment({
          id: `attachment-${index}`,
          url: `https://example.test/api/v1/files/photo-${index}.webp`
        })
    )
    // One attachment resolves through the local-file URL map; the rest are
    // left as absolute URLs (as a remote/unmapped attachment would be).
    attachments[0] = buildAttachment({
      id: 'attachment-0',
      url: 'https://example.test/api/v1/files/ab/cd.webp'
    })
    const status = buildStatus({ attachments })

    const activity = buildExportActivity({ status, urlToArchivePath })
    const object = activity.object as { attachment: { url: string }[] }

    expect(object.attachment).toHaveLength(attachments.length)
    expect(object.attachment[0].url).toBe('media_attachments/files/ab/cd.webp')
    expect(object.attachment[1].url).toBe(attachments[1].url)
  })

  it('keeps fitness attachments, which the federation serializer drops', () => {
    const status = buildStatus({
      attachments: [
        buildAttachment({
          id: 'fitness-attachment',
          mediaType: 'application/vnd.ant.fit',
          url: 'https://example.test/api/v1/fitness-files/abc',
          name: 'ride.fit'
        })
      ]
    })

    const activity = buildExportActivity({ status, urlToArchivePath })
    const object = activity.object as { attachment: { url: string }[] }

    expect(object.attachment).toHaveLength(1)
  })

  it('strips embedded reply objects but keeps the totalItems count', () => {
    const status = buildStatus({
      replies: [buildStatus({ id: 'reply-1' })]
    })

    const activity = buildExportActivity({ status, urlToArchivePath })
    const object = activity.object as {
      replies: { totalItems: number; items?: unknown }
    }

    expect(object.replies.totalItems).toBe(1)
    expect(object.replies).not.toHaveProperty('items')
  })

  it('shapes a Poll as a Create wrapping a Question with attachments retained', () => {
    const status = buildStatus({
      type: StatusType.enum.Poll,
      choices: [
        {
          statusId: 'status-1',
          title: 'A',
          totalVotes: 1,
          createdAt: 1,
          updatedAt: 1
        },
        {
          statusId: 'status-1',
          title: 'B',
          totalVotes: 2,
          createdAt: 1,
          updatedAt: 1
        }
      ],
      endAt: Date.now() + 1000,
      pollType: 'oneOf',
      attachments: [buildAttachment()]
    } as Partial<Status>)

    const activity = buildExportActivity({ status, urlToArchivePath })
    const object = activity.object as {
      type: string
      attachment: unknown[]
    }

    expect(activity.type).toBe('Create')
    expect(object.type).toBe('Question')
    expect(object.attachment).toHaveLength(1)
  })
})

describe('createOrderedCollectionWriter', () => {
  it('round-trips items into a valid OrderedCollection JSON document', async () => {
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'actor-archive-writer-test-')
    )
    const filePath = path.join(dir, 'collection.json')

    try {
      const writer = createOrderedCollectionWriter(
        filePath,
        'https://example.test/users/alice/outbox'
      )
      writer.addItem({ id: 'a' })
      writer.addItem({ id: 'b' })
      const count = await writer.close()

      expect(count).toBe(2)

      const parsed = JSON.parse(await fs.readFile(filePath, 'utf-8'))
      expect(parsed).toEqual({
        // The outbox collection embeds notes from toActivityPubObject, which
        // emits the FEP-044f quote aliases; anything that compacts this file
        // drops every term its context never defined.
        '@context': NOTE_ACTIVITY_CONTEXT,
        id: 'https://example.test/users/alice/outbox',
        type: 'OrderedCollection',
        orderedItems: [{ id: 'a' }, { id: 'b' }],
        totalItems: 2
      })
    } finally {
      await fs.rm(dir, { force: true, recursive: true })
    }
  })

  it('produces an empty orderedItems array when no item is added', async () => {
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'actor-archive-writer-test-')
    )
    const filePath = path.join(dir, 'collection.json')

    try {
      const writer = createOrderedCollectionWriter(filePath, 'id-1')
      const count = await writer.close()
      expect(count).toBe(0)

      const parsed = JSON.parse(await fs.readFile(filePath, 'utf-8'))
      expect(parsed.orderedItems).toEqual([])
      expect(parsed.totalItems).toBe(0)
    } finally {
      await fs.rm(dir, { force: true, recursive: true })
    }
  })
})

describe('database-backed collectors', () => {
  const database = getTestSQLDatabase()
  const domain = 'actor-archive-test.llun.test'
  let actorId: string
  let followersUrl: string

  beforeAll(async () => {
    await database.migrate()

    await database.createAccount({
      domain,
      email: 'archive-owner@example.test',
      username: 'archiveowner',
      privateKey: 'test-private-key',
      publicKey: 'test-public-key',
      passwordHash: 'unused'
    })
    const actor = await database.getActorFromUsername({
      username: 'archiveowner',
      domain
    })
    if (!actor) throw new Error('Failed to seed actor for actorArchive tests')
    actorId = actor.id
    followersUrl = actor.followersUrl
  })

  afterAll(async () => {
    await database.destroy()
  })

  describe('forEachActorStatus', () => {
    it('paginates past a page smaller than the total and includes non-public statuses', async () => {
      const total = 5
      for (let index = 0; index < total; index += 1) {
        await database.createNote({
          id: `${actorId}/statuses/pagination-${index}`,
          actorId,
          // Every status is included regardless of audience: the last one
          // carries no public recipient at all.
          to: index === total - 1 ? [] : [ACTIVITY_STREAM_PUBLIC],
          cc: index === total - 1 ? [] : [followersUrl],
          url: `https://${domain}/statuses/pagination-${index}`,
          text: `status ${index}`,
          createdAt: Date.now() + index
        })
      }

      const collected: string[] = []
      for await (const status of forEachActorStatus(database, actorId, 2)) {
        collected.push(status.id)
      }

      expect(collected).toHaveLength(total)
      expect(new Set(collected).size).toBe(total)
      expect(collected).toContain(`${actorId}/statuses/pagination-${total - 1}`)
    })
  })

  describe('forEachFitnessFile', () => {
    it('paginates past a page smaller than the total', async () => {
      const total = 3
      for (let index = 0; index < total; index += 1) {
        await database.createFitnessFile({
          actorId,
          path: `mock/${actorId}/pagination-${index}.gpx`,
          fileName: `pagination-${index}.gpx`,
          fileType: 'gpx',
          mimeType: 'application/gpx+xml',
          bytes: 100
        })
      }

      const collected: string[] = []
      for await (const file of forEachFitnessFile(database, actorId, 2)) {
        collected.push(file.id)
      }

      expect(collected).toHaveLength(total)
      expect(new Set(collected).size).toBe(total)
    })
  })

  describe('forEachLike', () => {
    it('paginates using the composite favourite cursor', async () => {
      const total = 3
      const statusIds: string[] = []
      for (let index = 0; index < total; index += 1) {
        const status = await database.createNote({
          id: `${actorId}/statuses/like-target-${index}`,
          actorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          url: `https://${domain}/statuses/like-target-${index}`,
          text: `like target ${index}`,
          createdAt: Date.now() + index
        })
        statusIds.push(status.id)
        await database.createLike({ actorId, statusId: status.id })
      }

      const collected: string[] = []
      for await (const like of forEachLike(database, actorId, 2)) {
        collected.push(like.statusId)
      }

      expect(collected).toHaveLength(total)
      expect(new Set(collected)).toEqual(new Set(statusIds))
    })
  })
})
