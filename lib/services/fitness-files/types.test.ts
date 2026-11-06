import { getConfig } from '@/lib/config'

import { FitnessFileSchema } from './types'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn()
}))

const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>

const file = (name: string, type: string, size = 10) =>
  new File([new Uint8Array(size)], name, { type })

describe('FitnessFileSchema', () => {
  beforeEach(() => {
    mockGetConfig.mockReturnValue({
      fitnessStorage: { maxFileSize: 50 * 1024 * 1024 }
    } as unknown as ReturnType<typeof getConfig>)
  })

  it.each([
    ['run.fit', 'application/vnd.ant.fit'],
    ['route.gpx', 'application/gpx+xml'],
    ['ride.tcx', 'application/vnd.garmin.tcx+xml']
  ])('accepts %s with its own MIME type', (name, type) => {
    expect(FitnessFileSchema.safeParse(file(name, type)).success).toBe(true)
  })

  it.each(['route.gpx', 'ride.tcx', 'run.fit'])(
    'accepts %s shared as application/octet-stream',
    (name) => {
      expect(
        FitnessFileSchema.safeParse(file(name, 'application/octet-stream'))
          .success
      ).toBe(true)
    }
  )

  it('accepts a file with no MIME type when the extension is known', () => {
    expect(FitnessFileSchema.safeParse(file('route.gpx', '')).success).toBe(
      true
    )
  })

  it('rejects octet-stream with an unknown extension', () => {
    expect(
      FitnessFileSchema.safeParse(file('notes.txt', 'application/octet-stream'))
        .success
    ).toBe(false)
  })

  it('rejects a known extension with an unrelated MIME type', () => {
    expect(
      FitnessFileSchema.safeParse(file('route.gpx', 'image/jpeg')).success
    ).toBe(false)
  })

  it('rejects a file over the configured limit', () => {
    expect(
      FitnessFileSchema.safeParse(
        file('run.fit', 'application/vnd.ant.fit', 50 * 1024 * 1024 + 1)
      ).success
    ).toBe(false)
  })
})
