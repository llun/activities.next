import fs from 'fs/promises'
import { tmpdir } from 'os'
import { basename, dirname, resolve } from 'path'

import { ACCEPTED_FILE_TYPES } from '@/lib/services/medias/constants'
import { MediaValidationError } from '@/lib/services/medias/errors'
import {
  EXTENSION_BY_CONTENT_TYPE,
  FALLBACK_STORED_FILE_NAME,
  assertDirectChildOf,
  createMediaTempFilePath,
  getStoredMediaExtension,
  sanitizeStoredFileName
} from '@/lib/services/medias/fileName'

const NULL_BYTE = String.fromCharCode(0)
const DEL = String.fromCharCode(0x7f)
const BACKSLASH = String.fromCharCode(92)
const RIGHT_TO_LEFT_OVERRIDE = String.fromCharCode(0x202e)
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b)

// Names a non-browser API client can put in the multipart `filename` parameter
// or the presigned request's `fileName` field. Browser uploads always send a
// basename, so these only reach the storage drivers from a crafted client.
const HOSTILE_FILE_NAMES = [
  {
    description: 'a deep POSIX traversal',
    fileName: '../../../../etc/cron.d/x'
  },
  {
    description: 'a traversal that clears the random prefix segment',
    fileName: '../../../evil.mp4'
  },
  {
    description: 'a traversal hidden behind a plausible extension',
    fileName: 'clip.mp4/../../../evil.html'
  },
  { description: 'an absolute path', fileName: '/etc/passwd' },
  { description: 'a bare parent reference', fileName: '..' },
  { description: 'a bare current-directory reference', fileName: '.' },
  {
    description: 'a Windows traversal',
    fileName: `..${BACKSLASH}..${BACKSLASH}evil.mp4`
  },
  {
    description: 'a name carrying a NUL byte',
    fileName: `clip.mp4${NULL_BYTE}.exe`
  },
  { description: 'a 500-character name', fileName: `${'a'.repeat(500)}.mp4` },
  {
    description: 'a 200-emoji name',
    fileName: `${'🎬'.repeat(200)}.mp4`
  }
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
      description: 'strips DEL',
      input: `clip${DEL}.mp4`,
      expected: 'clip.mp4'
    },
    {
      description: 'strips bidi overrides that disguise the extension',
      input: `photo${RIGHT_TO_LEFT_OVERRIDE}gnp.exe`,
      expected: 'photognp.exe'
    },
    {
      description: 'strips zero-width characters',
      input: `clip${ZERO_WIDTH_SPACE}.mp4`,
      expected: 'clip.mp4'
    },
    {
      description: 'trims surrounding whitespace',
      input: '  holiday clip.mp4  ',
      expected: 'holiday clip.mp4'
    },
    {
      description: 'falls back for a whitespace-only name',
      input: '   ',
      expected: FALLBACK_STORED_FILE_NAME
    },
    {
      description: 'falls back when stripping produces a parent reference',
      input: `.${NULL_BYTE}.`,
      expected: FALLBACK_STORED_FILE_NAME
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
    'reduces $description to a single inert path segment',
    ({ fileName }) => {
      const sanitized = sanitizeStoredFileName(fileName)

      expect(sanitized).not.toBe('')
      expect(sanitized).not.toBe('.')
      expect(sanitized).not.toBe('..')
      expect(sanitized).not.toContain('/')
      expect(sanitized).not.toContain(BACKSLASH)
      expect(sanitized).not.toContain(NULL_BYTE)
      expect(sanitized.trim()).toBe(sanitized)
      expect(Buffer.byteLength(sanitized)).toBeLessThanOrEqual(200)
    }
  )

  it('truncates on a character boundary rather than splitting a code point', () => {
    const sanitized = sanitizeStoredFileName(`${'🎬'.repeat(200)}.mp4`)

    expect(Buffer.byteLength(sanitized)).toBeLessThanOrEqual(200)
    expect(sanitized).toBe('🎬'.repeat(50))
  })

  it('leaves no trailing whitespace after truncating at the byte cap', () => {
    const sanitized = sanitizeStoredFileName(`${'a'.repeat(199)} bbbb.mp4`)

    expect(sanitized).toBe('a'.repeat(199))
  })
})

describe('getStoredMediaExtension', () => {
  // The mapping is what keeps a supplied name out of the stored path. A type
  // accepted for upload but missing from the map would fall through to the
  // name, which is the hole this module exists to close.
  it.each(ACCEPTED_FILE_TYPES)('maps the accepted type %s', (contentType) => {
    expect(EXTENSION_BY_CONTENT_TYPE[contentType]).toMatch(/^\.[a-z0-9]+$/)
  })

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
      description: 'maps m4a audio uploads',
      contentType: 'audio/mp4',
      fileName: 'sound.m4a',
      expected: '.m4a'
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
      description: 'ignores content type casing',
      contentType: 'VIDEO/MP4',
      fileName: 'clip.mp4',
      expected: '.mp4'
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
      description: 'lowercases a fallback extension',
      contentType: 'application/octet-stream',
      fileName: 'clip.MP4',
      expected: '.mp4'
    },
    {
      description: 'drops a fallback extension outside the media allowlist',
      contentType: 'application/octet-stream',
      fileName: 'clip.mp4/../../../evil.html',
      expected: ''
    },
    {
      description: 'drops a non-alphanumeric fallback extension',
      contentType: 'application/octet-stream',
      fileName: 'clip.tar-gz',
      expected: ''
    },
    {
      description: 'drops an oversized fallback extension',
      contentType: 'application/octet-stream',
      fileName: `clip.${'a'.repeat(64)}`,
      expected: ''
    },
    {
      description: 'drops an empty fallback extension',
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

describe('assertDirectChildOf', () => {
  it('returns the path when it sits directly in the directory', () => {
    expect(assertDirectChildOf('/var/data', '/var/data/clip.mp4')).toBe(
      '/var/data/clip.mp4'
    )
  })

  it.each([
    { description: 'a path above the directory', filePath: '/var/clip.mp4' },
    {
      description: 'a path that traverses out of the directory',
      filePath: '/var/data/../clip.mp4'
    },
    {
      description: 'a path nested below the directory',
      filePath: '/var/data/nested/clip.mp4'
    },
    { description: 'an unrelated absolute path', filePath: '/etc/cron.d/x' }
  ])('rejects $description', ({ filePath }) => {
    expect(() => assertDirectChildOf('/var/data', filePath)).toThrow(
      MediaValidationError
    )
  })
})

describe('createMediaTempFilePath', () => {
  it.each(HOSTILE_FILE_NAMES)(
    'keeps $description inside the temp directory',
    ({ fileName }) => {
      const filePath = createMediaTempFilePath(fileName)

      expect(resolve(dirname(filePath))).toBe(resolve(tmpdir()))
    }
  )

  it('separates the random prefix from the name', () => {
    const filePath = createMediaTempFilePath('holiday clip.mp4')

    // Without the separator, a name starting with `..` merges into the prefix's
    // own segment and `join` resolves it back to a predictable `<tmpdir>/…`.
    expect(basename(filePath)).toMatch(/^[0-9a-f]{16}-holiday clip\.mp4$/)
  })

  it('never repeats a path for the same name', () => {
    const paths = new Set(
      Array.from({ length: 50 }, () => createMediaTempFilePath('clip.mp4'))
    )

    expect(paths.size).toBe(50)
  })

  it.each(HOSTILE_FILE_NAMES)(
    'produces a writable path for $description',
    async ({ fileName }) => {
      const filePath = createMediaTempFilePath(fileName)

      // Writing proves the sanitized name is a usable single segment: a NUL byte
      // would raise ERR_INVALID_ARG_VALUE and an unbounded name ENAMETOOLONG,
      // both of which turn an upload into a 500.
      await fs.writeFile(filePath, 'video-bytes')
      try {
        expect(await fs.readFile(filePath, 'utf-8')).toBe('video-bytes')
      } finally {
        await fs.unlink(filePath).catch(() => undefined)
      }
    }
  )
})
