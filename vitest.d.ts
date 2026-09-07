/// <reference types="vitest/globals" />
/// <reference types="jest-extended" />
/// <reference types="@testing-library/jest-dom" />
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'
import 'vitest'
// Back-compat type aliases so existing `jest.Mock` / `jest.MockedFunction` /
// `jest.Mocked` annotations keep type-checking under Vitest without touching
// hundreds of call sites. Runtime `jest.*` calls were codemodded to `vi.*`;
// only these type-position references remain.
import type {
  Mock as ViMock,
  MockInstance as ViMockInstance,
  Mocked as ViMocked,
  MockedClass as ViMockedClass,
  MockedFunction as ViMockedFunction
} from 'vitest'

declare module 'vitest' {
  interface Assertion<R = unknown, T = unknown>
    extends jest.Matchers<R, T>, TestingLibraryMatchers<unknown, R> {}
  interface AsymmetricMatchersContaining
    extends
      jest.Matchers<unknown, unknown>,
      TestingLibraryMatchers<unknown, unknown> {}
}

declare global {
  // Jest-compatible global assertion helper provided by vitest.setup.ts.
  function fail(message?: string): never

  namespace jest {
    type Mock<T extends (...args: any[]) => any = (...args: any[]) => any> =
      ViMock<T>
    type MockedFunction<T extends (...args: any[]) => any> = ViMockedFunction<T>
    type Mocked<T> = ViMocked<T>
    type MockedClass<T extends abstract new (...args: any[]) => any> =
      ViMockedClass<T>
    type SpyInstance<
      T extends (...args: any[]) => any = (...args: any[]) => any
    > = ViMockInstance<T>
    // jest's MockInstance is parameterised by <TReturn, TArgs>; map it onto
    // Vitest's function-typed MockInstance. Used by jest-fetch-mock's types.
    type MockInstance<
      TReturn = any,
      TArgs extends any[] = any[]
    > = ViMockInstance<(...args: TArgs) => TReturn>
  }
}

export {}
