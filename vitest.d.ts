/// <reference types="vitest/globals" />
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
