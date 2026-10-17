import { chooseProfileFieldIcon } from './profileFieldIcon'

const link = (href: string) => `<a href="${href}">x</a>`

describe('chooseProfileFieldIcon', () => {
  it.each([
    ['Location', 'Lisbon', 'location'],
    ['Based in', 'Lisbon, Portugal', 'location'],
    ['Lives in', 'Bangkok', 'location'],
    ['Living in', 'Bangkok', 'location'],
    ['Home town', 'Bangkok', 'location'],
    ['Photos', link('https://photos.example/@me'), 'image'],
    ['Me', link('https://www.flickr.com/people/me'), 'image'],
    ['Gram', link('https://instagram.com/me'), 'image'],
    ['Strava', link('https://fitness.example/athletes/me'), 'activity'],
    ['Me', link('https://connect.garmin.com/me'), 'activity'],
    ['Email', link('mailto:me@example.com'), 'mail'],
    ['Contact', link('mailto:me@example.com'), 'mail'],
    ['Website', link('https://example.com'), 'link'],
    ['Pronouns', 'they/them', 'text']
  ])('%s -> %s', (label, value, kind) => {
    expect(chooseProfileFieldIcon(label, value).kind).toBe(kind)
  })

  it('matches case-insensitively', () => {
    expect(chooseProfileFieldIcon('LOCATION', 'x').kind).toBe('location')
  })

  it('reports whether the value is a link', () => {
    expect(
      chooseProfileFieldIcon('Web', link('https://a.example')).isLink
    ).toBe(true)
    expect(chooseProfileFieldIcon('Web', 'a.example').isLink).toBe(false)
  })

  it('reads the href attribute, not an href= inside another value', () => {
    expect(
      chooseProfileFieldIcon(
        'Me',
        '<a rel=" href=https://flickr.com" href="https://evil.example">x</a>'
      ).kind
    ).toBe('link')
  })

  it('does not match keywords inside other words', () => {
    expect(chooseProfileFieldIcon('Pride', 'x').kind).toBe('text')
  })

  it.each([
    'Homepage',
    'Home page',
    'Home',
    'Live',
    'Plant-based',
    'Livestream',
    'Runbook',
    'Rider'
  ])('%s is not a keyword match', (label) => {
    expect(chooseProfileFieldIcon(label, 'x').kind).toBe('text')
  })

  it.each([
    'https://runkit.com/me',
    'https://app.run.app/me',
    'https://example.com/u/running',
    'https://example.com/photos/me',
    'https://notstrava.com/me',
    'not a url'
  ])('does not take %s for an image or activity host', (href) => {
    expect(chooseProfileFieldIcon('Me', link(href)).kind).toBe('link')
  })

  it.each([
    ['https://www.strava.com/athletes/1', 'activity'],
    ['https://connect.garmin.com/u/me', 'activity'],
    ['https://garmin.com/me', 'activity'],
    ['https://pixelfed.social/me', 'image'],
    ['https://www.flickr.com/me', 'image'],
    ['https://500px.com/me', 'image']
  ])('takes the host of %s for %s', (href, kind) => {
    expect(chooseProfileFieldIcon('Me', link(href)).kind).toBe(kind)
  })

  it('ignores a data-href attribute', () => {
    expect(
      chooseProfileFieldIcon('Me', '<a data-href="https://strava.com/x">x</a>')
        .isLink
    ).toBe(false)
  })

  it.each([
    ['text', () => '&lt;'.repeat(500_000)],
    ['anchors', () => '<a href="https://a.example">x</a>'.repeat(60_000)],
    [
      'spaces before href',
      () => `<a${' '.repeat(1_900_000)}href="https://a.example">x</a>`
    ],
    ['repeated href', () => ' href'.repeat(380_000)]
  ])('stays linear on a 2 MB %s value', (_name, make) => {
    const value = make()
    const started = performance.now()
    chooseProfileFieldIcon('Web', value)
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('stays linear on a 2 MB label', () => {
    const started = performance.now()
    chooseProfileFieldIcon('a'.repeat(2_000_000), 'x')
    expect(performance.now() - started).toBeLessThan(1000)
  })
})
