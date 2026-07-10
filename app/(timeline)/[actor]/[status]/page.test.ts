import { generateMetadata } from './page'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(),
  getBaseURL: vi.fn().mockReturnValue('https://llun.test')
}))

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn()
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn()
}))

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn()
}))

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: vi.fn()
}))

vi.mock('./Header', () => ({
  Header: () => null
}))

vi.mock('./RemoteStatusLoading', () => ({
  RemoteStatusLoading: () => null
}))

vi.mock('./StatusBox', () => ({
  StatusBox: () => null
}))

describe('generateMetadata', () => {
  it('emits the oEmbed discovery link for the status page', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({
        actor: '@test1@llun.test',
        status: 'status-1'
      })
    })

    const pageUrl = 'https://llun.test/%40test1%40llun.test/status-1'
    expect(metadata.title).toBe('Activities.next: @test1@llun.test status')
    expect(metadata.alternates?.types).toEqual({
      'application/json+oembed': `https://llun.test/api/oembed?url=${encodeURIComponent(pageUrl)}`
    })
  })

  it('does not throw when the actor route has malformed URI escapes', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({
        actor: '%E0%A4%A',
        status: 'status-id'
      })
    })

    expect(metadata.title).toBe('Activities.next: %E0%A4%A status')
    // Malformed escapes fall back to the raw segment, re-encoded.
    const pageUrl = 'https://llun.test/%25E0%25A4%25A/status-id'
    expect(metadata.alternates?.types).toEqual({
      'application/json+oembed': `https://llun.test/api/oembed?url=${encodeURIComponent(pageUrl)}`
    })
  })
})
