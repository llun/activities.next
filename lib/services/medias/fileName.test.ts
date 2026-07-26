import fs from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, relative, resolve } from 'path'

import {
  FALLBACK_STORED_FILE_NAME,
  createMediaTempFilePath,
  getStoredMediaExtension,
  sanitizeStoredFileName
} from '@/lib/services/medias/fileName'

const NULL_BYTE = String.fromCharCode(0)
const BACKSLASH = String.fromCharCode(92)

// Names a non-browser API client can put in the multipart `filename` parameter
// or the presigned request's `fileName` field. Browser uploads always send a
// basename, so these only reach the storage drivers from a crafted client.
const HOSTILE_FILE_NAMES = [
  '../../../../etc/cron.d/x',
  'deadbeef../../evil.mp4',
  'clip.mp4/../../../evil.html',
  '/etc/passwd',
  '..',
  '.',
  `..${BACKSLASH}..${BACKSLASH}evil.mp4`,
  `clip.mp4${NULL_BYTE}.exe`,
  `${'a'.repeat(500)}.mp4`,
  `${'🎬'.repeat(200)}.mp4`
]

describe('sanitizeStoredFileName', () => {
  it.each([
    {
      description: 'keeps an ordinary name unchanged',
      input: 'holiday clip.mp4',
      expected: 'holiday clip.mp4'
    },
    {
      description: 'drops POSIX directory components',
      input: '../../../../etc/cron.d/x',
      expected: 'x'
    },
    {
      description: 'drops an absolute path prefix',
      input: '/etc/passwd',
      expected: 'passwd'
    },
    {
      description: 'drops Windows directory components',
      input: `..${BACKSLASH}..${BACKSLASH}evil.mp4`,
      expected: 'evil.mp4'
    },
    {
      description: 'strips control characters',
      input: `clip${NULL_BYTE}.mp4`,
      expected: 'clip.mp4'
    },
    {
      description: 'falls back for a bare parent reference',
      input: '..',
      expected: FALLBACK_STORED_FILE_NAME
    },
    {
      description: 'falls back for a bare current-directory reference',
      input: '.',
      expected: FALLBACK_STORED_FILE_NAME
    },
    {
      description: 'falls back for an empty name',
      input: '',
      expected: FALLBACK_STORED_FILE_NAME
    },
    {
      description: 'falls back when a name is only separators',
      input: '///',
      expected: FALLBACK_STORED_FILE_NAME
    },
    {
      description: 'falls back when a name is only control characters',
      input: `${NULL_BYTE}${NULL_BYTE}`,
      expected: FALLBACK_STORED_FILE_NAME
    }
  ])('$description', ({ input, expected }) => {
    expect(sanitizeStoredFileName(input)).toBe(expected)
  })

  it.each(HOSTILE_FILE_NAMES)(
    'reduces %j to a single inert path segment',
    (fileName) => {
      const sanitized = sanitizeStoredFileName(fileName)

      expect(sanitized).not.toBe('')
      expect(sanitized).not.toBe('.')
      expect(sanitized).not.toBe('..')
      expect(sanitized).not.toContain('/')
      expect(sanitized).not.toContain(BACKSLASH)
      expect(sanitized).not.toContain(NULL_BYTE)
      expect(Buffer.byteLength(sanitized)).toBeLessThanOrEqual(200)
    }
  )

  it('truncates on a character boundary rather than splitting a code point', () => {
    const sanitized = sanitizeStoredFileName(`${'🎬'.repeat(200)}.mp4`)

    expect(Buffer.byteLength(sanitized)).toBeLessThanOrEqual(200)
    expect(sanitized).toBe('🎬'.repeat(50))
  })
})

describe('getStoredMediaExtension', () => {
  it.each([
    {
      description: 'maps png uploads',
      contentType: 'image/png',
      fileName: 'photo.png',
      expected: '.png'
    },
    {
      description: 'normalises jpeg to a single spelling',
      contentType: 'image/jpeg',
      fileName: 'photo.JPEG',
      expected: '.jpg'
    },
    {
      description: 'stores quicktime under the mp4 extension',
      contentType: 'video/quicktime',
      fileName: 'movie.mov',
      expected: '.mp4'
    },
    {
      description: 'stores uppercase quicktime names under the mp4 extension',
      contentType: 'video/quicktime',
      fileName: 'MOVIE.MOV',
      expected: '.mp4'
    },
    {
      description: 'maps webm uploads',
      contentType: 'video/webm',
      fileName: 'clip.webm',
      expected: '.webm'
    },
    {
      description: 'ignores content type parameters',
      contentType: 'video/mp4; codecs="avc1"',
      fileName: 'clip.mp4',
      expected: '.mp4'
    },
    {
      description: 'ignores a mismatched extension on the supplied name',
      contentType: 'video/mp4',
      fileName: 'clip.mp4/../../../evil.html',
      expected: '.mp4'
    },
    {
      description: 'falls back to the name for an unknown content type',
      contentType: 'application/octet-stream',
      fileName: 'clip.mp4',
      expected: '.mp4'
    },
    {
      description: 'drops an oversized fallback extension',
      contentType: 'application/octet-stream',
      fileName: `clip.${'a'.repeat(64)}`,
      expected: ''
    },
    {
      description: 'drops a non-alphanumeric fallback extension',
      contentType: 'application/octet-stream',
      fileName: 'clip..',
      expected: ''
    },
    {
      description: 'drops a fallback extension for a name without one',
      contentType: 'application/octet-stream',
      fileName: 'clip',
      expected: ''
    }
  ])('$description', ({ contentType, fileName, expected }) => {
    expect(getStoredMediaExtension(contentType, fileName)).toBe(expected)
  })
})

describe('createMediaTempFilePath', () => {
  it.each(HOSTILE_FILE_NAMES)(
    'keeps %j inside the temp directory',
    (fileName) => {
      const filePath = createMediaTempFilePath(fileName)

      expect(resolve(dirname(filePath))).toBe(resolve(tmpdir()))
      expect(relative(resolve(tmpdir()), resolve(filePath))).not.toContain('..')
    }
  )

  it('separates the random prefix from the name', () => {
    const filePath = createMediaTempFilePath('holiday clip.mp4')

    expect(filePath).toMatch(/\/[0-9a-f]{16}-holiday clip\.mp4$/)
  })

  it('never repeats a path for the same name', () => {
    const paths = new Set(
      Array.from({ length: 50 }, () => createMediaTempFilePath('clip.mp4'))
    )

    expect(paths.size).toBe(50)
  })

  it.each(HOSTILE_FILE_NAMES)(
    'produces a writable path for %j',
    async (fileName) => {
      const filePath = createMediaTempFilePath(fileName)

      // Writing proves the sanitized name is a usable single segment: a null
      // byte would raise ERR_INVALID_ARG_VALUE and an unbounded name
      // ENAMETOOLONG, both of which turn an upload into a 500.
      await fs.writeFile(filePath, 'video-bytes')
      try {
        expect(await fs.readFile(filePath, 'utf-8')).toBe('video-bytes')
      } finally {
        await fs.unlink(filePath).catch(() => undefined)
      }
    }
  )
})
