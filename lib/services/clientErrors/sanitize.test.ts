import { sanitiseClientErrorStack, sanitiseClientErrorText } from './sanitize'

describe('client error sanitization', () => {
  it.each([
    ['https://host/a.js?token=abc#hash', 'https://host/a.js'],
    [
      'webkit-masked-url://host/a.js?token=abc',
      'webkit-masked-url://host/a.js'
    ],
    ['app://host/a.js#section', 'app://host/a.js'],
    ['Failed to fetch /api/x?token=abc', 'Failed to fetch /api/x'],
    ['Is this ok? yes', 'Is this ok? yes']
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
