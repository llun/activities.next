import { chooseProfileFieldIcon } from './profileFieldIcon'

const link = (href: string) => `<a href="${href}">x</a>`

describe('chooseProfileFieldIcon', () => {
  it.each([
    ['Location', 'Lisbon', 'location'],
    ['Based in', 'Lisbon, Portugal', 'location'],
    ['Lives in', 'Bangkok', 'location'],
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

  it('reports whether the value is a link, quoted or not', () => {
    expect(
      chooseProfileFieldIcon('Web', link('https://a.example')).isLink
    ).toBe(true)
    expect(
      chooseProfileFieldIcon('Web', '<a href=https://a.example>a</a>').isLink
    ).toBe(true)
    expect(chooseProfileFieldIcon('Web', 'a.example').isLink).toBe(false)
  })

  it('uses the host of an unquoted href', () => {
    expect(
      chooseProfileFieldIcon('Me', '<a href=https://www.flickr.com/me>x</a>')
        .kind
    ).toBe('image')
  })

  it('does not match keywords inside other words', () => {
    expect(chooseProfileFieldIcon('Pride', 'x').kind).toBe('text')
  })

  it.each(['Homepage', 'Home page', 'Home', 'Livestream', 'Runbook', 'Rider'])(
    '%s is not a keyword match',
    (label) => {
      expect(chooseProfileFieldIcon(label, 'x').kind).toBe('text')
    }
  )

  it('does not match a keyword inside a host name', () => {
    expect(
      chooseProfileFieldIcon('Me', link('https://runkit.com/me')).kind
    ).toBe('link')
  })
})
