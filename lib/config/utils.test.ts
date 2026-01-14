import { matcher } from './utils'

describe('config utils', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('matcher', () => {
    it('returns true when env var with prefix exists', () => {
      process.env.TEST_PREFIX_VAR = 'value'

      expect(matcher('TEST_PREFIX_')).toBe(true)
    })

    it('returns false when no env var with prefix exists', () => {
      expect(matcher('NONEXISTENT_PREFIX_')).toBe(false)
    })
  })
})
