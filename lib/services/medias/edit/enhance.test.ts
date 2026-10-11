import { requestVisionCompletion } from '@/lib/services/altText/openai'

import { EnhanceError, requestEnhance } from './enhance'

vi.mock('@/lib/services/altText/openai', () => ({
  requestVisionCompletion: vi.fn()
}))

const config = {
  endpoint: 'https://vision.example.com/v1/chat/completions',
  apiKey: 'sk-test',
  model: 'vision-1'
}

const style = { global: { exposure: 0.2 }, subject: null, background: null }
const answer = JSON.stringify({
  natural: style,
  vivid: style,
  dramatic: style
})

describe('requestEnhance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the three styles and the model', async () => {
    vi.mocked(requestVisionCompletion).mockResolvedValue(answer)

    await expect(requestEnhance(config, Buffer.from('jpeg'))).resolves.toEqual({
      natural: style,
      vivid: style,
      dramatic: style,
      model: 'vision-1'
    })
  })

  it('never follows a redirect to another host with the photo', async () => {
    vi.mocked(requestVisionCompletion).mockResolvedValue(answer)

    await requestEnhance(config, Buffer.from('jpeg'))

    expect(requestVisionCompletion).toHaveBeenCalledWith(
      config,
      expect.any(Buffer),
      'image/jpeg',
      expect.objectContaining({ allowCrossHostRedirects: false })
    )
  })

  it.each([
    ['nothing', null],
    ['prose', 'Sure, here you go'],
    ['an out-of-range value', answer.replace('0.2', '9')]
  ])('throws EnhanceError for %s', async (_, text) => {
    vi.mocked(requestVisionCompletion).mockResolvedValue(text)

    await expect(
      requestEnhance(config, Buffer.from('jpeg'))
    ).rejects.toBeInstanceOf(EnhanceError)
  })

  it('lets a transport failure through', async () => {
    vi.mocked(requestVisionCompletion).mockRejectedValue(new Error('down'))

    await expect(requestEnhance(config, Buffer.from('jpeg'))).rejects.toThrow(
      'down'
    )
  })
})
