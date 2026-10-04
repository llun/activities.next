import { useSyncExternalStore } from 'react'

const subscribe = () => () => {}

/**
 * False on the server and while the client hydrates server HTML, true from the
 * render after that — and on the very first render of a component mounted
 * purely on the client (a client-side navigation), which has no server HTML to
 * match.
 *
 * Gate anything that depends on the viewer's environment on it, such as a time
 * shown in the viewer's own zone: the server does not know that zone, so the
 * hydrating render has to repeat the server's text, and the local one takes
 * over in the re-render React schedules straight after. `suppressHydrationWarning`
 * is not a substitute — it silences the mismatch but keeps the server's text.
 */
export const useHasHydrated = () =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  )
