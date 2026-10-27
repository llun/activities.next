import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const forbiddenPatterns: [string, RegExp][] = [
  ['createNoteFromUserInput', /\bcreateNoteFromUserInput\b/],
  ['publishCreatedStatus', /\bpublishCreatedStatus\b/],
  ['addStatusToTimelines', /\baddStatusToTimelines\b/],
  ['notifyStatusRecipients', /\bnotifyStatusRecipients\b/],
  ['getMentions', /\bgetMentions\b/],
  ['syncStatusLinkPreview', /\bsyncStatusLinkPreview\b/],
  [
    'notification creation',
    /\b(?:create\w*Notification|send\w*Notification)\b/
  ],
  [
    'federation job',
    /\b(?:SEND_NOTE_JOB_NAME|SEND_QUOTE_REQUEST_JOB_NAME|LIKE_JOB_NAME|FETCH_LINK_PREVIEW_JOB_NAME|SendNoteJob|SendQuoteRequestJob|LikeJob|FetchLinkPreviewJob)\b/
  ],
  ['fetch', /\bfetch\b/],
  [
    'HTTP module',
    /(?:from\s*|import\s*\(|require\s*\()\s*['"](?:node:)?(?:http|https|undici)(?:\/[^'"]*)?['"]|\bhttps?\.(?:request|get|Agent)\b|\bundici\b/
  ],
  [
    'outbound HTTP helper',
    /(?:@\/lib\/utils\/|from\s*['"]\.\/)(?:request|safeRemoteFetch|safeImageDownload)\b|\b(?:safeRemoteFetch|safeImageFetch)\b/
  ],
  ['queue access or publish', /\bgetQueue\b|\.publish\s*\(|\bcreateQueueJob\b/]
]

const findViolations = (source: string) =>
  forbiddenPatterns.flatMap(([name, pattern]) =>
    pattern.test(source) ? [name] : []
  )

const sourceFilesUnder = async (root: string): Promise<string[]> => {
  const entries = await readdir(root, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(root, entry.name)
      if (entry.isDirectory()) return sourceFilesUnder(fullPath)
      if (
        !entry.isFile() ||
        !/\.(?:[cm]?js|tsx?)$/.test(entry.name) ||
        /\.(?:test|spec)\.[^.]+$/.test(entry.name) ||
        entry.name.endsWith('.d.ts')
      ) {
        return []
      }
      return [fullPath]
    })
  )
  return nested.flat().sort()
}

describe('account importer side-effect boundary', () => {
  it('contains no publication, notification, network, or queue code', async () => {
    const root = path.dirname(fileURLToPath(import.meta.url))
    const sourceFiles = await sourceFilesUnder(root)
    const failures: string[] = []
    for (const file of sourceFiles) {
      const source = await readFile(file, 'utf8')
      for (const violation of findViolations(source)) {
        failures.push(`${path.relative(root, file)}: ${violation}`)
      }
    }
    expect(failures).toEqual([])
  })

  it('detects a planted violation in source text', () => {
    const planted = `
      import { createNoteFromUserInput, getQueue } from '@/lib/actions/createNote'
      import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'
      await fetch('https://remote.test/archive')
      await getQueue().publish({ name: 'SendNoteJob' })
    `
    expect(findViolations(planted)).toEqual(
      expect.arrayContaining([
        'createNoteFromUserInput',
        'federation job',
        'fetch',
        'outbound HTTP helper',
        'queue access or publish'
      ])
    )
  })
})
