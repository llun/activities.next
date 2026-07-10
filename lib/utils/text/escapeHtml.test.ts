import { escapeHtml } from './escapeHtml'

describe('escapeHtml', () => {
  it.each([
    {
      description: 'escapes all five HTML special characters',
      input: `<script>alert("x") & 'y'</script>`,
      expected:
        '&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;'
    },
    {
      description: 'passes plain text through unchanged',
      input: 'plain text 123',
      expected: 'plain text 123'
    },
    {
      description: 'escapes ampersands first so entities are not double-built',
      input: '&lt;',
      expected: '&amp;lt;'
    }
  ])('$description', ({ input, expected }) => {
    expect(escapeHtml(input)).toBe(expected)
  })
})
