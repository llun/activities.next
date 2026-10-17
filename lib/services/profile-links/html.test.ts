import { formatProfileFieldValue } from '@/lib/utils/text/formatProfileFieldValue'

import {
  getLinkFromFieldHtml,
  getVerifiableFieldUrl,
  hasRelMeLinkTo
} from './html'

const PROFILE = 'https://llun.test/@anna'
const ACTOR_ID = 'https://llun.test/users/anna'

describe('hasRelMeLinkTo', () => {
  it('finds an <a rel="me"> pointing at the profile URL', () => {
    const html = `<body><a rel="me" href="${PROFILE}">me</a></body>`
    expect(hasRelMeLinkTo(html, [PROFILE, ACTOR_ID])).toBe(true)
  })

  it('finds a <link rel="me"> in the head', () => {
    const html = `<head><link rel="me" href="${ACTOR_ID}"></head>`
    expect(hasRelMeLinkTo(html, [PROFILE, ACTOR_ID])).toBe(true)
  })

  it('matches the me token among several space-separated tokens', () => {
    const html = `<a rel="nofollow  noopener ME" href="${PROFILE}">x</a>`
    expect(hasRelMeLinkTo(html, [PROFILE])).toBe(true)
  })

  it('compares the href case-insensitively', () => {
    const html = `<a rel="me" href="HTTPS://LLUN.TEST/@Anna">x</a>`
    expect(hasRelMeLinkTo(html, [PROFILE])).toBe(true)
  })

  it('does not match a token that only contains me', () => {
    const html = `<a rel="member homepage" href="${PROFILE}">x</a>`
    expect(hasRelMeLinkTo(html, [PROFILE])).toBe(false)
  })

  it('does not match a link without rel', () => {
    expect(hasRelMeLinkTo(`<a href="${PROFILE}">x</a>`, [PROFILE])).toBe(false)
  })

  it('does not match another href', () => {
    const html = `<a rel="me" href="https://llun.test/@bob">x</a>`
    expect(hasRelMeLinkTo(html, [PROFILE, ACTOR_ID])).toBe(false)
  })

  it('ignores rel="me" on other elements', () => {
    const html = `<div rel="me" href="${PROFILE}"></div>`
    expect(hasRelMeLinkTo(html, [PROFILE])).toBe(false)
  })
})

describe('getLinkFromFieldHtml', () => {
  it('reads the URL of the markup this server federates', () => {
    const html = formatProfileFieldValue('https://example.com/me')
    expect(getLinkFromFieldHtml(html)).toBe('https://example.com/me')
  })

  it('reads a link whose text equals its href', () => {
    expect(
      getLinkFromFieldHtml(
        '<a href="https://example.com/">https://example.com/</a>'
      )
    ).toBe('https://example.com/')
  })

  it('reads a bare URL, entities included', () => {
    expect(getLinkFromFieldHtml('https://example.com/?a=1&amp;b=2')).toBe(
      'https://example.com/?a=1&b=2'
    )
  })

  it('refuses a link whose text differs from its href', () => {
    expect(
      getLinkFromFieldHtml(
        '<a href="https://evil.example/">https://good.example/</a>'
      )
    ).toBeNull()
  })

  it('refuses a value with more than one node', () => {
    expect(
      getLinkFromFieldHtml(
        '<a href="https://a.example/">https://a.example/</a> and more'
      )
    ).toBeNull()
  })

  it('refuses plain text, and a link that is not http(s)', () => {
    expect(getLinkFromFieldHtml('they/them')).toBeNull()
    expect(
      getLinkFromFieldHtml('<a href="ftp://a.example/">ftp://a.example/</a>')
    ).toBeNull()
  })
})

describe('getVerifiableFieldUrl', () => {
  it('takes a local value as the raw URL', () => {
    expect(
      getVerifiableFieldUrl(' https://example.com ', { remote: false })
    ).toBe('https://example.com')
  })

  it('does not read a local value as HTML', () => {
    expect(
      getVerifiableFieldUrl(
        '<a href="https://a.example/">https://a.example/</a>',
        {
          remote: false
        }
      )
    ).toBeNull()
  })

  it('takes a remote value from its HTML', () => {
    expect(
      getVerifiableFieldUrl(
        '<a href="https://a.example/">https://a.example/</a>',
        {
          remote: true
        }
      )
    ).toBe('https://a.example/')
  })

  it('refuses text that is not one URL', () => {
    expect(
      getVerifiableFieldUrl('see https://a.example', { remote: false })
    ).toBeNull()
  })
})
