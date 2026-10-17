import {
  formatProfileFieldValue,
  getProfileFieldHttpsUrl
} from '@/lib/utils/text/formatProfileFieldValue'

describe('formatProfileFieldValue', () => {
  it('turns an https URL into Mastodon link markup with the scheme hidden', () => {
    expect(formatProfileFieldValue('https://example.com/path')).toBe(
      '<a href="https://example.com/path" target="_blank" rel="nofollow noopener me" translate="no"><span class="invisible">https://</span><span class="">example.com/path</span><span class="invisible"></span></a>'
    )
  })

  it('hides www. together with the scheme', () => {
    expect(formatProfileFieldValue('http://www.example.com')).toBe(
      '<a href="http://www.example.com" target="_blank" rel="nofollow noopener me" translate="no"><span class="invisible">http://www.</span><span class="">example.com</span><span class="invisible"></span></a>'
    )
  })

  it('cuts a long address at 30 characters with an ellipsis and hides the rest', () => {
    const rest = 'example.com/a/very/long/path/that/keeps/going'
    const html = formatProfileFieldValue(`https://${rest}`)
    expect(html).toContain(
      `<span class="ellipsis">${rest.slice(0, 30)}</span><span class="invisible">${rest.slice(30)}</span>`
    )
  })

  it('does not mark an address of exactly 30 characters as cut', () => {
    const rest = 'example.com/0123456789abcdefgh'
    expect(rest).toHaveLength(30)
    expect(formatProfileFieldValue(`https://${rest}`)).toContain(
      `<span class="">${rest}</span><span class="invisible"></span>`
    )
  })

  it('escapes the characters of a URL that are special in HTML', () => {
    const html = formatProfileFieldValue('https://example.com/?a=1&b="2"')
    expect(html).toContain(
      'href="https://example.com/?a=1&amp;b=&quot;2&quot;"'
    )
    expect(html).not.toContain('b="2"')
  })

  it('trims the value before reading it as a URL', () => {
    expect(formatProfileFieldValue('  https://example.com  ')).toContain(
      'href="https://example.com"'
    )
  })

  it('escapes plain text', () => {
    expect(formatProfileFieldValue('<b>they</b> & "them"')).toBe(
      '&lt;b&gt;they&lt;/b&gt; &amp; &quot;them&quot;'
    )
  })

  it.each([
    'javascript:alert(1)',
    'ftp://example.com/file',
    'mailto:me@example.com',
    'see https://example.com for more',
    'example.com'
  ])('leaves %s as escaped text', (value) => {
    expect(formatProfileFieldValue(value)).not.toContain('<a ')
  })

  it('keeps a custom emoji shortcode as text', () => {
    expect(formatProfileFieldValue(':blobcat:')).toBe(':blobcat:')
  })

  it('never splits an emoji at the cut and reassembles to the href', () => {
    const rest = `${'a'.repeat(29)}😀tail/path`
    const url = `https://${rest}`
    const html = formatProfileFieldValue(url)
    const visible = html.match(
      /<span class="ellipsis">([^<]*)<\/span><span class="invisible">([^<]*)<\/span>/
    )
    expect(visible).not.toBeNull()
    const [, display, hidden] = visible as RegExpMatchArray
    expect(display).toBe(`${'a'.repeat(29)}😀`)
    expect(hidden).toBe('tail/path')
    expect(`https://${display}${hidden}`).toBe(url)
    expect(html).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/)
  })
})

describe('getProfileFieldHttpsUrl', () => {
  it('accepts one https URL only', () => {
    expect(getProfileFieldHttpsUrl('https://example.com/a')).toBe(
      'https://example.com/a'
    )
    expect(getProfileFieldHttpsUrl('http://example.com')).toBeNull()
    expect(getProfileFieldHttpsUrl('https://a.example b')).toBeNull()
    expect(getProfileFieldHttpsUrl('they/them')).toBeNull()
  })
})
