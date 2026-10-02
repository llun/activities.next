import { isMainThread } from 'node:worker_threads'

// `vitest.config.ts` pins the suite's time zone to UTC and lists this file in
// both of its projects, so each pool is checked: `threads` (a worker thread)
// and `forks` (a child process, where this code is on the main thread).
// CI starts the test shards in a non-UTC `TZ` (`.github/workflows/ci.yml`,
// "Run test shard"); on a UTC runner none of this could fail.
describe(`time zone pin ${isMainThread ? 'in a forked process' : 'on a worker thread'}`, () => {
  // Fixed dates in both halves of the year: a zone such as Europe/London is
  // also at offset 0, but only in winter.
  it.each(['2026-01-15T12:00:00.000Z', '2026-07-15T12:00:00.000Z'])(
    'runs Date in UTC at %s',
    (instant) => {
      expect(new Date(instant).getTimezoneOffset()).toBe(0)
    }
  )

  it('resolves the default Intl time zone to UTC', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC')
  })
})
