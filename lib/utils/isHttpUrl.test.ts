import { isHttpUrl } from '@/lib/utils/isHttpUrl'

describe('isHttpUrl', () => {
  it.each([
    'https://example.com/a',
    'http://example.com',
    'HTTPS://EXAMPLE.COM'
  ])('accepts %s', (value) => {
    expect(isHttpUrl(value)).toBe(true)
  })

  it.each([
    'javascript:alert(1)',
    ' javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'mailto:a@example.com',
    '/relative/path',
    '//example.com/protocol-relative',
    '',
    null,
    undefined,
    42
  ])('rejects %s', (value) => {
    expect(isHttpUrl(value)).toBe(false)
  })
})
