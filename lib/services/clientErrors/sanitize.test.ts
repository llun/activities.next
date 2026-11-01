/** @vitest-size medium */
import { readdirSync } from 'node:fs'

import {
  CLIENT_ERROR_SECRET_ROUTES,
  sanitiseClientErrorPathname,
  sanitiseClientErrorStack,
  sanitiseClientErrorText
} from './sanitize'

describe('client error sanitization', () => {
  it.each([
    ['https://host/a.js?token=abc#hash', 'https://host/a.js'],
    [
      'webkit-masked-url://host/a.js?token=abc',
      'webkit-masked-url://host/a.js'
    ],
    ['app://host/a.js#section', 'app://host/a.js'],
    ['Failed to fetch /api/x?token=abc', 'Failed to fetch /api/x'],
    ['Is this ok? yes', 'Is this ok? yes'],
    ['(https://h/a.js?v=1:2:3)', '(https://h/a.js:2:3)'],
    ['https://host/a.js?redirect=/a(b)&token=secret', 'https://host/a.js'],
    ['https://user:pass@host/a.js?token=abc', 'https://host/a.js'],
    ['app://user:pass@host/a.js', 'app://host/a.js'],
    ['"/api/x?token=abc', '"/api/x'],
    ["'/api/x#secret", "'/api/x"]
  ])('sanitizes %s', (input, expected) => {
    expect(sanitiseClientErrorText(input)).toBe(expected)
  })

  it('keeps stack coordinates after stripping a URL query', () => {
    expect(sanitiseClientErrorStack('at https://h/a.js?v=1:2:3')).toBe(
      'at https://h/a.js:2:3'
    )
  })

  it('rewrites Safari named and anonymous frames to V8 format', () => {
    expect(
      sanitiseClientErrorStack(
        'fn@https://host/a.js:1:2\n@https://host/b.js:3:4'
      )
    ).toBe(
      '    at fn (https://host/a.js:1:2)\n    at <anonymous> (https://host/b.js:3:4)'
    )
  })
})

describe('client error credential paths', () => {
  it.each(CLIENT_ERROR_SECRET_ROUTES)(
    'redacts %s in text and pathname',
    (route) => {
      const pathname = route.replace(/\[[^\]]+\]/, 'private-token') + '/tiles'
      const redacted = route.replace(/\[[^\]]+\]/, '[token]') + '/tiles'
      expect(sanitiseClientErrorPathname(pathname + '?token=secret#hash')).toBe(
        redacted
      )
      expect(sanitiseClientErrorText(`Failed https://host${pathname}`)).toBe(
        `Failed https://host${redacted}`
      )
      expect(
        sanitiseClientErrorStack(`    at fn (https://host${pathname}:1:2)`)
      ).toBe(`    at fn (https://host${redacted}:1:2)`)
    }
  )

  it('covers every app dynamic token segment with the redaction list', () => {
    const app = new URL('../../../app/', import.meta.url)
    const walk = (directory: URL, segments: string[] = []) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const next = [...segments, entry.name]
        if (/^\[.*token.*\]$/i.test(entry.name)) {
          const route =
            '/' +
            next
              .filter(
                (segment) =>
                  !segment.startsWith('(') && !segment.startsWith('@')
              )
              .join('/')
          expect(CLIENT_ERROR_SECRET_ROUTES, route).toContain(route)
          const pathname = route.replace(/\[[^\]]+\]/g, 'credential-value')
          expect(sanitiseClientErrorPathname(pathname), route).not.toContain(
            'credential-value'
          )
        }
        walk(new URL(entry.name + '/', directory), next)
      }
    }
    walk(app)
  })
})

describe('client error stack frames', () => {
  it.each([
    [
      'global code@https://h/@alice/a.js:1:2',
      '    at global code (https://h/@alice/a.js:1:2)'
    ],
    [
      '    at https://host/@alice/a.js:1:2',
      '    at https://host/@alice/a.js:1:2'
    ],
    ['fn(arg)@https://host/a.js:1:2', 'fn(arg)@https://host/a.js:1:2'],
    ['fn@https://host/a.js', 'fn@https://host/a.js']
  ])('normalizes only eligible frames: %s', (input, expected) => {
    expect(sanitiseClientErrorStack(input)).toBe(expected)
  })
})
