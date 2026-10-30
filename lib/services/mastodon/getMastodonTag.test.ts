import { getMastodonTag } from './getMastodonTag'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn().mockReturnValue({ host: 'llun.test' })
}))

describe('getMastodonTag', () => {
  it('omits featuring when the caller does not provide it', () => {
    expect(getMastodonTag('running', true)).toEqual({
      name: 'running',
      url: 'https://llun.test/tags/running',
      history: [],
      following: true
    })
  })
})
