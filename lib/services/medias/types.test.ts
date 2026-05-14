import { PresigedMediaInput } from './types'

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
