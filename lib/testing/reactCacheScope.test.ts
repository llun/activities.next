import { runInReactCacheScope, serverCache } from './reactCacheScope'

describe('runInReactCacheScope', () => {
  // Counts calls to the wrapped function, so "did this memoize?" is observable
  // without depending on anything else.
  const buildCountingCache = () => {
    const calls: string[] = []
    const cached = serverCache((key: string) => {
      calls.push(key)
      return calls.length
    })
    return { calls, cached }
  }

  it('memoizes a repeated call inside one scope', async () => {
    const { calls, cached } = buildCountingCache()

    await runInReactCacheScope(async () => {
      cached('a')
      cached('a')
    })

    expect(calls).toEqual(['a'])
  })

  it('starts each scope with an empty store', async () => {
    const { calls, cached } = buildCountingCache()

    await runInReactCacheScope(async () => cached('a'))
    await runInReactCacheScope(async () => cached('a'))

    expect(calls).toEqual(['a', 'a'])
  })

  // The point of the guard. React's `cache` only takes its passthrough branch
  // while the dispatcher slot is empty, so a scope that left one installed would
  // silently memoize code that runs outside any request — which is what a
  // concurrent scope used to do on its way out.
  it('leaves no dispatcher behind, so a later call is not memoized', async () => {
    const { calls, cached } = buildCountingCache()

    await runInReactCacheScope(async () => cached('a'))
    cached('b')
    cached('b')

    expect(calls).toEqual(['a', 'b', 'b'])
  })

  it('restores the dispatcher when the scope throws', async () => {
    const { calls, cached } = buildCountingCache()

    await expect(
      runInReactCacheScope(async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')

    cached('a')
    cached('a')

    expect(calls).toEqual(['a', 'a'])
  })

  it('refuses a second scope entered while one is live', async () => {
    await expect(
      runInReactCacheScope(async () => {
        await runInReactCacheScope(async () => 'inner')
      })
    ).rejects.toThrow('runInReactCacheScope is already active')
  })

  // The shape that used to fail silently: two scopes started together, neither
  // awaited before the other. The second one's `previousDispatcher` was the
  // first one's dispatcher rather than the true original, so whichever settled
  // last reinstalled a live dispatcher and every later out-of-scope call was
  // memoized. It now rejects instead, and the surviving scope still cleans up.
  it('refuses a second scope started concurrently and still cleans up', async () => {
    const { calls, cached } = buildCountingCache()

    await expect(
      Promise.all([
        runInReactCacheScope(async () => cached('a')),
        runInReactCacheScope(async () => cached('b'))
      ])
    ).rejects.toThrow('runInReactCacheScope is already active')

    cached('c')
    cached('c')

    expect(calls).toEqual(['a', 'c', 'c'])
  })

  it('stays usable after refusing a nested scope', async () => {
    const { calls, cached } = buildCountingCache()

    await expect(
      runInReactCacheScope(async () => {
        await runInReactCacheScope(async () => 'inner')
      })
    ).rejects.toThrow('runInReactCacheScope is already active')

    await runInReactCacheScope(async () => {
      cached('a')
      cached('a')
    })

    expect(calls).toEqual(['a'])
  })
})
