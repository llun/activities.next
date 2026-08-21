import { buildHeatmapEmbedImageUrl } from './heatmapEmbedImageUrl'

describe('buildHeatmapEmbedImageUrl', () => {
  it.each([
    {
      description: 'omits format by default',
      format: undefined,
      expected: 'https://llun.test/embed/heatmap/tok123/image?w=600&h=400'
    },
    {
      description: 'asks for a raster when format is given',
      format: 'png' as const,
      expected:
        'https://llun.test/embed/heatmap/tok123/image?w=600&h=400&format=png'
    }
  ])('$description', ({ format, expected }) => {
    expect(
      buildHeatmapEmbedImageUrl({
        origin: 'https://llun.test',
        shareToken: 'tok123',
        width: 600,
        height: 400,
        format
      })
    ).toBe(expected)
  })

  it('does not double the slash when the origin has a trailing slash', () => {
    expect(
      buildHeatmapEmbedImageUrl({
        origin: 'https://llun.test//',
        shareToken: 'tok123',
        width: 600,
        height: 400
      })
    ).toBe('https://llun.test/embed/heatmap/tok123/image?w=600&h=400')
  })
})
