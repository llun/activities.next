/**
 * @vitest-environment jsdom
 */
import {
  getProfileNavigationTarget,
  isProfilePathname
} from './profileNavigationTarget'

const location = { origin: window.location.origin, pathname: '/' }

const clickOn = (
  anchorHtml: string,
  overrides: Partial<Parameters<typeof getProfileNavigationTarget>[0]> = {}
) => {
  const container = document.createElement('div')
  container.innerHTML = anchorHtml
  const anchor = container.querySelector('a')
  const target = anchor?.querySelector('span') ?? anchor ?? container
  return {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    target,
    ...overrides
  }
}

describe('isProfilePathname', () => {
  it.each([
    ['/@alice@example.com', true],
    ['/@alice@example.com/', true],
    ['/%40alice%40example.com', true],
    ['/@testuser@localhost:3000', true],
    ['/@alice', false],
    ['/@alice@example.com/123', false],
    ['/@alice@example.com/followers', false],
    ['/notifications', false],
    ['/%E0%A4%A', false]
  ])('treats %s as a profile: %s', (pathname, expected) => {
    expect(isProfilePathname(pathname)).toBe(expected)
  })
})

describe('getProfileNavigationTarget', () => {
  it('returns the profile pathname for a plain click inside a profile link', () => {
    expect(
      getProfileNavigationTarget(
        clickOn('<a href="/@alice@example.com"><span>Alice</span></a>'),
        location
      )
    ).toBe('/@alice@example.com')
  })

  it.each([
    ['a middle click', { button: 1 }],
    ['a cmd-click', { metaKey: true }],
    ['a ctrl-click', { ctrlKey: true }],
    ['a shift-click', { shiftKey: true }],
    ['an alt-click', { altKey: true }],
    [
      'a click cancelled before it reached the listener',
      { defaultPrevented: true }
    ]
  ])('ignores %s', (_name, overrides) => {
    expect(
      getProfileNavigationTarget(
        clickOn('<a href="/@alice@example.com">Alice</a>', overrides),
        location
      )
    ).toBeNull()
  })

  it.each([
    [
      'a link opening another tab',
      '<a href="/@a@b.test" target="_blank">x</a>'
    ],
    ['a download link', '<a href="/@a@b.test" download>x</a>'],
    ['another origin', '<a href="https://b.test/@a@b.test">x</a>'],
    ['a status page', '<a href="/@a@b.test/123">x</a>'],
    ['a non-profile route', '<a href="/notifications">x</a>'],
    ['an anchor without href', '<a>x</a>'],
    ['a click outside any link', '<p>x</p>']
  ])('ignores %s', (_name, html) => {
    expect(getProfileNavigationTarget(clickOn(html), location)).toBeNull()
  })

  it('ignores a link to the profile already on screen', () => {
    expect(
      getProfileNavigationTarget(clickOn('<a href="/@a@b.test">x</a>'), {
        origin: window.location.origin,
        pathname: '/%40a%40b.test'
      })
    ).toBeNull()
  })
})
