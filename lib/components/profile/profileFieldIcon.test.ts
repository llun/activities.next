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

  it('marks keyword matches as specific and the fallbacks as not', () => {
    expect(chooseProfileFieldIcon('Based in', 'x').specific).toBe(true)
    expect(chooseProfileFieldIcon('Pronouns', 'x').specific).toBe(false)
    expect(
      chooseProfileFieldIcon('Website', link('https://example.com')).specific
    ).toBe(false)
  })

  it('does not match keywords inside other words', () => {
    expect(chooseProfileFieldIcon('Pride', 'x').kind).toBe('text')
  })
})
