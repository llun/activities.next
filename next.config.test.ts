import nextConfig from './next.config'

describe('nextConfig', () => {
  it('does not inject proxy host config into the build env', () => {
    expect(nextConfig.env).toBeUndefined()
  })
})
