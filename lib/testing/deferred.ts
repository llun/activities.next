/**
 * A promise together with the functions that settle it, so a test can decide
 * exactly when an awaited call resolves or rejects and sequence async React
 * updates deterministically. Handing a mock `deferred.promise` and resolving it
 * inside `act()` is what separates the pending render from the settled one — an
 * already-resolved `Promise.resolve()` collapses both into the first flush.
 */
export type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

export const createDeferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}
