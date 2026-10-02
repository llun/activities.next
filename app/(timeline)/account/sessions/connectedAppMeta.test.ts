import { formatAppWebsite, formatConnectedAppMeta } from './connectedAppMeta'

const NOW = new Date('2026-10-02T12:00:00.000Z').getTime()
const DAY = 24 * 60 * 60 * 1000

describe('formatAppWebsite', () => {
  it('drops the scheme and keeps the path', () => {
    expect(formatAppWebsite('https://tapbots.com/ivory')).toBe(
      'tapbots.com/ivory'
    )
    expect(formatAppWebsite('http://example.com/app')).toBe('example.com/app')
  })

  it('drops a trailing slash', () => {
    expect(formatAppWebsite('https://strava.com/')).toBe('strava.com')
    expect(formatAppWebsite('https://strava.com')).toBe('strava.com')
  })

  it('trims whitespace, reads the scheme in any case and drops every trailing slash', () => {
    expect(formatAppWebsite('  HTTPS://example.com/app//  ')).toBe(
      'example.com/app'
    )
  })

  it('leaves a website that has no scheme alone', () => {
    expect(formatAppWebsite('icecubesapp.com')).toBe('icecubesapp.com')
  })

  it('does not strip schemes other than http and https', () => {
    expect(formatAppWebsite('ftp://example.com')).toBe('ftp://example.com')
  })
})

describe('formatConnectedAppMeta', () => {
  it('reads host and relative time for an authorized app', () => {
    expect(
      formatConnectedAppMeta({
        website: 'https://tapbots.com/ivory',
        signIn: false,
        authorizedAt: NOW - 12 * DAY,
        currentTime: NOW
      })
    ).toBe('tapbots.com/ivory · Authorized 12 days ago')
  })

  it('says "Signs you in" for a sign-in app', () => {
    expect(
      formatConnectedAppMeta({
        website: 'https://strava.com',
        signIn: true,
        authorizedAt: NOW - 65 * DAY,
        currentTime: NOW
      })
    ).toBe('strava.com · Signs you in 2 months ago')
  })

  it('omits the host when the app has no website', () => {
    expect(
      formatConnectedAppMeta({
        website: null,
        signIn: false,
        authorizedAt: NOW - 3 * 60 * 60 * 1000,
        currentTime: NOW
      })
    ).toBe('Authorized about 3 hours ago')
  })
})
