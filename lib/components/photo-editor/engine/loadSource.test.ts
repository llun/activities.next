import { loadSource } from './loadSource'

const bitmap = (width: number, height: number) => ({
  width,
  height,
  close: vi.fn()
})

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x']) }))
  )
})

afterEach(() => vi.unstubAllGlobals())

describe('loadSource', () => {
  it('decodes with from-image orientation and no colour conversion', async () => {
    const create = vi.fn(async () => bitmap(40, 30))
    vi.stubGlobal('createImageBitmap', create)
    await loadSource('/x', undefined, { width: 40, height: 30 })
    expect(create).toHaveBeenCalledWith(expect.any(Blob), {
      imageOrientation: 'from-image',
      colorSpaceConversion: 'none'
    })
  })

  it('rejects a decoded size that differs from the stored one', async () => {
    const decoded = bitmap(30, 40)
    vi.stubGlobal('createImageBitmap', async () => decoded)
    await expect(
      loadSource('/x', undefined, { width: 40, height: 30 })
    ).rejects.toThrow(/stored size/)
    expect(decoded.close).toHaveBeenCalled()
  })
})
