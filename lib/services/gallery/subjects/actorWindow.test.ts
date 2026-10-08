import { createActorWindow } from './actorWindow'

describe('createActorWindow', () => {
  it('allows the limit per key and refuses the next', () => {
    const window = createActorWindow({ limit: 2, windowMs: 1000 })
    expect(window.take('a', 0)).toBe(true)
    expect(window.take('a', 10)).toBe(true)
    expect(window.take('a', 20)).toBe(false)
    expect(window.take('b', 20)).toBe(true)
  })

  it('starts a new window once the old one has ended', () => {
    const window = createActorWindow({ limit: 1, windowMs: 1000 })
    expect(window.take('a', 0)).toBe(true)
    expect(window.take('a', 999)).toBe(false)
    expect(window.take('a', 1000)).toBe(true)
  })
})
