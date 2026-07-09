import { MediaSchema, PresigedMediaInput } from './types'

describe('PresigedMediaInput', () => {
  it('normalizes checksum input to lowercase', () => {
    const parsed = PresigedMediaInput.parse({
      fileName: 'photo.png',
      checksum: 'A9993E364706816ABA3E25717850C26C9CD0D89D',
      width: 10,
      height: 20,
      contentType: 'image/png',
      size: 1024
    })

    expect(parsed.checksum).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
  })
})

describe('MediaSchema', () => {
  const descriptionOnly = MediaSchema.pick({ description: true })

  it('rejects alt text longer than 1500 characters', () => {
    const result = descriptionOnly.safeParse({ description: 'a'.repeat(1501) })
    expect(result.success).toBe(false)
  })

  it.each([
    {
      description: 'keeps alt text at the 1500-character Mastodon limit',
      value: 'a'.repeat(1500),
      expected: 'a'.repeat(1500)
    },
    {
      description: 'normalises an empty description to null',
      value: '',
      expected: null
    },
    {
      description: 'normalises a whitespace-only description to null',
      value: '   ',
      expected: null
    }
  ])('$description', ({ value, expected }) => {
    const result = descriptionOnly.safeParse({ description: value })
    expect(result.success).toBe(true)
    expect(result.success && result.data.description).toBe(expected)
  })
})
