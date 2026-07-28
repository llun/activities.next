import { logger } from '@/lib/utils/logger'

import { requiredStorageValue } from './storageValue'

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    warn: vi.fn()
  }
}))

describe('requiredStorageValue', () => {
  const originalEnv = process.env
  const mockWarn = logger.warn as jest.Mock

  beforeEach(() => {
    process.env = { ...originalEnv }
    mockWarn.mockReset()
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('returns undefined when the variable is unset', () => {
    delete process.env.ACTIVITIES_MEDIA_STORAGE_PATH

    expect(
      requiredStorageValue('ACTIVITIES_MEDIA_STORAGE_PATH', 'media storage')
    ).toBeUndefined()
    expect(mockWarn).not.toHaveBeenCalled()
  })

  it.each([
    { description: 'an empty string', value: '' },
    { description: 'spaces', value: '   ' },
    { description: 'a tab', value: '\t' },
    { description: 'a newline', value: '\n' },
    { description: 'mixed whitespace', value: ' \t \n ' },
    // `trim()` strips these too, which a hand-rolled /^[ \t\n]*$/ would not —
    // and they are what a value pasted from a web page actually contains.
    { description: 'a non-breaking space', value: ' ' },
    { description: 'an ideographic space', value: '　' }
  ])('returns null and warns when the value is $description', ({ value }) => {
    process.env.ACTIVITIES_MEDIA_STORAGE_PATH = value

    expect(
      requiredStorageValue('ACTIVITIES_MEDIA_STORAGE_PATH', 'media storage')
    ).toBeNull()
    expect(mockWarn).toHaveBeenCalledWith(
      'ACTIVITIES_MEDIA_STORAGE_PATH is set but empty; media storage will be disabled'
    )
  })

  it.each([
    { description: 'an unpadded value', value: '/data/uploads' },
    { description: 'a padded value', value: '  /data/uploads  ' },
    { description: 'a newline-padded value', value: '/data/uploads\n' }
  ])('returns the trimmed value for $description', ({ value }) => {
    process.env.ACTIVITIES_MEDIA_STORAGE_PATH = value

    expect(
      requiredStorageValue('ACTIVITIES_MEDIA_STORAGE_PATH', 'media storage')
    ).toBe('/data/uploads')
    expect(mockWarn).not.toHaveBeenCalled()
  })

  it('names the variable and the subject it disables in the warning', () => {
    process.env.ACTIVITIES_FITNESS_STORAGE_BUCKET = ''

    requiredStorageValue('ACTIVITIES_FITNESS_STORAGE_BUCKET', 'fitness storage')

    expect(mockWarn).toHaveBeenCalledWith(
      'ACTIVITIES_FITNESS_STORAGE_BUCKET is set but empty; fitness storage will be disabled'
    )
  })
})
