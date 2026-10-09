import { readFileSync } from 'fs'
import fs from 'fs/promises'
import fetchMock from 'jest-fetch-mock'
import os from 'os'
import path from 'path'

import { MAX_FILE_SIZE } from '@/lib/services/medias/constants'
import { Attachment } from '@/lib/types/domain/attachment'
import { logger } from '@/lib/utils/logger'
import { safeImageFetch } from '@/lib/utils/safeImageDownload'

import {
  REMOTE_ATTACHMENT_FETCH_TIMEOUT_MS,
  buildRemoteFetchBudgetWarning,
  registerAttachmentUrl
} from './actorArchive'
import { buildAttachment } from './actorArchive.testUtils'

// A spy that CALLS THROUGH: the refusal tests below must exercise the real
// address policy — a mock would prove only the wiring and would still pass
// against a plain `fetch`. This only makes the call arguments assertable.
vi.mock('@/lib/utils/safeImageDownload', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/utils/safeImageDownload')>()
  return { ...actual, safeImageFetch: vi.fn(actual.safeImageFetch) }
})

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

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

  // "The deadline is stamped once per RUN, not once per attachment" is not
  // asserted here any more. Three source-text spellings of that guard were
  // tried and each was defeated in review by a different rewrite of the same
  // bug — the last one a helper defined above the loop and called inside it,
  // which is textually indistinguishable from the correct code. A regex can
  // say where an expression is written, never how often it is evaluated, so
  // that property is proved by running a whole export in
  // `actorArchiveExport.test.ts` instead.

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
