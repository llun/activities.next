import { getHashFromStringClient } from '@/lib/utils/getHashFromStringClient'

describe('getHashFromStringClient', () => {
  it('generates consistent hash for the same input', async () => {
    const input = 'test string'

    const firstHash = await getHashFromStringClient(input)
    const secondHash = await getHashFromStringClient(input)

    expect(firstHash).toBe(secondHash)
  })

  it('matches SHA-256 hash for empty string', async () => {
    const hash = await getHashFromStringClient('')

    expect(hash).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    )
  })

  it('returns 64-character lowercase hexadecimal hash', async () => {
    const hash = await getHashFromStringClient('!@#$%^&*()_+')

    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })
})
