import { act } from '@testing-library/react'
import type { ReactElement } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import type { Mock } from 'vitest'
import { vi } from 'vitest'

/**
 * Renders `element` to a string as the server would, then hydrates that HTML
 * into a container attached to `document.body`, the way a browser does. For a
 * test that must show a client component hydrates the server's text without a
 * mismatch and only then switches to the viewer's own value: assert on
 * `serverHtml`, and on `onRecoverableError` (React reports a hydration mismatch
 * there) and `container` after the hydration `act()`.
 *
 * Call it inside the test's own `withTimeZone` callback when the zone matters:
 * the server render happens at call time. The caller must `unmount()` in a
 * `finally`, so the root (and any timer or listener its effects started) does
 * not outlive the test — an abandoned root keeps running and can fire into a
 * later test. `unmount` is idempotent and also removes the container.
 *
 * Needs a DOM, so the test file declares `@vitest-environment jsdom`.
 */
export const hydrateServerHtml = async (
  element: ReactElement
): Promise<{
  serverHtml: string
  container: HTMLElement
  onRecoverableError: Mock
  unmount: () => void
}> => {
  const serverHtml = renderToString(element)

  const container = document.createElement('div')
  container.innerHTML = serverHtml
  document.body.appendChild(container)
  const onRecoverableError = vi.fn()

  let root: ReturnType<typeof hydrateRoot> | undefined
  let unmounted = false
  const unmount = () => {
    if (unmounted) return
    unmounted = true
    act(() => root?.unmount())
    container.remove()
  }

  try {
    await act(async () => {
      root = hydrateRoot(container, element, { onRecoverableError })
    })
  } catch (error) {
    unmount()
    throw error
  }

  return { serverHtml, container, onRecoverableError, unmount }
}
