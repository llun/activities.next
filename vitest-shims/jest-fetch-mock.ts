// Compatibility shim so existing `import fetchMock from 'jest-fetch-mock'`
// usages keep working under Vitest. `jest-fetch-mock` is aliased to this module
// in vitest.config.ts. It exposes a single Vitest-backed fetch mock instance so
// the global `fetch` and every test's imported `fetchMock` are the same object.
import { vi } from 'vitest'
import createFetchMock from 'vitest-fetch-mock'

const fetchMocker = createFetchMock(vi)

export type FetchMock = typeof fetchMocker

export const enableFetchMocks = () => fetchMocker.enableMocks()
export const disableFetchMocks = () => fetchMocker.disableMocks()

export default fetchMocker
