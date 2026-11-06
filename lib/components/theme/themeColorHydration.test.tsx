/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'

import {
  THEME_COLOR_DARK,
  THEME_COLOR_LIGHT,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  applyThemeColor
} from './theme-core'

const LIGHT_MEDIA = '(prefers-color-scheme: light)'
const DARK_MEDIA = '(prefers-color-scheme: dark)'

// The two metas Next renders from `viewport.themeColor` in app/layout.tsx.
// React 19 hoists a <meta> into <head> and, on hydration, adopts the server's
// node by matching its `content` (and name), not its `media`.
const ViewportThemeColor = () => (
  <>
    <meta name="theme-color" media={LIGHT_MEDIA} content={THEME_COLOR_LIGHT} />
    <meta name="theme-color" media={DARK_MEDIA} content={THEME_COLOR_DARK} />
  </>
)

const metas = () =>
  Array.from(document.head.querySelectorAll('meta[name="theme-color"]')).map(
    (meta) => ({
      media: meta.getAttribute('media'),
      content: meta.getAttribute('content')
    })
  )

// hydrateRoot is driven by hand here (no Testing Library render), so tell
// React this is a test environment that wraps its updates in act().
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe('theme-color metas across hydration', () => {
  let root: ReturnType<typeof hydrateRoot> | null = null

  beforeEach(() => {
    // As the server sends them, and the empty body the client hydrates.
    document.head.innerHTML =
      `<meta name="theme-color" media="${LIGHT_MEDIA}" content="${THEME_COLOR_LIGHT}">` +
      `<meta name="theme-color" media="${DARK_MEDIA}" content="${THEME_COLOR_DARK}">`
    document.body.innerHTML = '<div id="root"></div>'
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    localStorage.clear()
    document.head.innerHTML = ''
    document.body.innerHTML = ''
  })

  const hydrate = async () => {
    await act(async () => {
      root = hydrateRoot(
        document.getElementById('root')!,
        <ViewportThemeColor />
      )
    })
  }

  // The pre-paint script and the explicit choice must leave React's adopted
  // nodes matchable, or React appends a copy beside them (a third meta).
  it.each(['dark', 'light'] as const)(
    'keeps exactly the two metas for an explicit %s choice',
    async (mode) => {
      localStorage.setItem(THEME_STORAGE_KEY, mode)
      new Function(THEME_INIT_SCRIPT)()

      await hydrate()
      applyThemeColor(mode)

      expect(metas()).toHaveLength(2)
    }
  )

  it('shows only the chosen colour for an explicit choice', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    new Function(THEME_INIT_SCRIPT)()
    await hydrate()
    applyThemeColor('dark')

    // The only meta whose media can match is the dark one, whatever the OS.
    expect(metas()).toEqual([
      { media: 'not all', content: THEME_COLOR_LIGHT },
      { media: 'all', content: THEME_COLOR_DARK }
    ])
  })

  it('restores the server pair for system', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    new Function(THEME_INIT_SCRIPT)()
    await hydrate()

    applyThemeColor('system')

    expect(metas()).toEqual([
      { media: LIGHT_MEDIA, content: THEME_COLOR_LIGHT },
      { media: DARK_MEDIA, content: THEME_COLOR_DARK }
    ])
  })
})
