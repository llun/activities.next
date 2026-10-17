import { renderRemoteMarkdown } from './renderRemoteMarkdown'

describe('renderRemoteMarkdown', () => {
  it('returns an empty string for anything that is not a string', () => {
    expect(renderRemoteMarkdown(undefined)).toEqual('')
    expect(renderRemoteMarkdown(null)).toEqual('')
    expect(renderRemoteMarkdown(['a'])).toEqual('')
  })

  it('renders links and escapes everything else', () => {
    expect(renderRemoteMarkdown('<b> [a](https://example.com/x) y')).toEqual(
      '<p>&lt;b&gt; <a href="https://example.com/x" rel="nofollow noopener noreferrer" target="_blank">a</a> y</p>'
    )
  })

  it('finishes quickly on a long run of unclosed brackets', () => {
    const started = performance.now()
    renderRemoteMarkdown('['.repeat(200_000))
    renderRemoteMarkdown(`[${'['.repeat(200_000)}](https://example.com)`)
    expect(performance.now() - started).toBeLessThan(500)
  })

  it('finishes quickly on long URL-like lines', () => {
    const started = performance.now()
    renderRemoteMarkdown(`https://${'a'.repeat(500_000)}`)
    renderRemoteMarkdown(`[x](https://${'a'.repeat(500_000)}`)
    renderRemoteMarkdown(`${'[x](https://a.b/'.repeat(30_000)}`)
    renderRemoteMarkdown(`${'http://' + '.'.repeat(1990) + 'a '}`.repeat(500))
    expect(performance.now() - started).toBeLessThan(500)
  })
})
