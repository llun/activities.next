import { safeExternalHref } from '@/lib/components/trends/safeHref'

describe('safeExternalHref', () => {
  it.each([
    ['https://example.com/article', 'https://example.com/article'],
    ['http://example.com', 'http://example.com'],
    ['HTTPS://Example.com', 'HTTPS://Example.com']
  ])('passes through the http(s) URL %s', (input, expected) => {
    expect(safeExternalHref(input)).toBe(expected)
  })

  it.each([
    ['javascript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['mailto:a@b.com'],
    ['//evil.example'],
    ['/relative/path'],
    [''],
    [null],
    [undefined]
  ])('collapses the unsafe or missing value %s to #', (input) => {
    expect(safeExternalHref(input as string | null | undefined)).toBe('#')
  })
})
