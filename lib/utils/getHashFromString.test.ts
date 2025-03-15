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

  it('should handle special characters', () => {
    const input = '!@#$%^&*()_+'
    const hash = getHashFromString(input)
    expect(hash).toHaveLength(64) // SHA-256 produces 64 character hex string
    expect(hash).toMatch(/^[a-f0-9]{64}$/) // Should be hexadecimal
  })

  it('should handle unicode characters', () => {
    const input = '你好世界'
    const hash = getHashFromString(input)
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })
})
