import { isRenderableHashtagName } from './isRenderableHashtagName'

describe('isRenderableHashtagName', () => {
  it.each([
    ['hello', true],
    ['_', true],
    ['123abc', true],
    ['abc123', true],
    ['1_2', true],
    ['12345', false],
    ['', false],
    ['café', false],
    ['a-b', false],
    ['1a!', false]
  ])('%j is renderable: %s', (name, expected) => {
    expect(isRenderableHashtagName(name)).toBe(expected)
  })

  it('returns quickly for a long name that is not renderable', () => {
    const start = performance.now()
    expect(isRenderableHashtagName(`${'a'.repeat(200_000)}!`)).toBe(false)
    expect(performance.now() - start).toBeLessThan(500)
  })
})
