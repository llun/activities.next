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

  it('refuses a name over the hashtag length limit', () => {
    expect(isRenderableHashtagName('a'.repeat(255))).toBe(true)
    expect(isRenderableHashtagName('a'.repeat(256))).toBe(false)
  })

  it('returns quickly for a long name that is not renderable', () => {
    const start = performance.now()
    expect(isRenderableHashtagName(`${'a'.repeat(200_000)}!`)).toBe(false)
    expect(performance.now() - start).toBeLessThan(500)
  })
})
