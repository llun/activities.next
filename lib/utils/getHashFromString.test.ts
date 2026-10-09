import { getHashFromString } from './getHashFromString'

describe('getHashFromString', () => {
  it('should generate consistent hash for the same input', () => {
    const input = 'test string'
    const firstHash = getHashFromString(input)
    const secondHash = getHashFromString(input)
    expect(firstHash).toBe(secondHash)
  })

  it('should generate different hashes for different inputs', () => {
    const input1 = 'test string 1'
    const input2 = 'test string 2'
    const hash1 = getHashFromString(input1)
    const hash2 = getHashFromString(input2)
    expect(hash1).not.toBe(hash2)
  })

  it('should handle empty string', () => {
    const input = ''
    const hash = getHashFromString(input)
    // SHA-256 hash of empty string
    expect(hash).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    )
  })

  it.each([
    { description: 'special characters', input: '!@#$%^&*()_+' },
    { description: 'unicode characters', input: '你好世界' }
  ])('should handle $description', ({ input }) => {
    const hash = getHashFromString(input)
    // SHA-256 produces a 64 character hexadecimal string
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })
})
