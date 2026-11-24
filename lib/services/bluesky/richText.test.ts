import { getPublicProfiles } from '@/lib/services/bluesky/appview'
import { buildBlueskyFacets } from '@/lib/services/bluesky/richText'

vi.mock('@/lib/services/bluesky/appview', () => ({
  getPublicProfiles: vi.fn()
}))

const decoder = new TextDecoder()
const encoder = new TextEncoder()

const sliceFacet = (
  text: string,
  index: { byteStart: number; byteEnd: number }
) =>
  decoder.decode(encoder.encode(text).subarray(index.byteStart, index.byteEnd))

describe('buildBlueskyFacets', () => {
  beforeEach(() => {
    vi.mocked(getPublicProfiles).mockReset()
    vi.mocked(getPublicProfiles).mockResolvedValue([])
  })

  it('returns empty array for plain text without facets', async () => {
    await expect(buildBlueskyFacets('just plain text')).resolves.toEqual([])
    expect(getPublicProfiles).not.toHaveBeenCalled()
  })

  it('computes UTF-8 byte offsets accurately after multibyte text and emoji', async () => {
    vi.mocked(getPublicProfiles).mockResolvedValue([
      { did: 'did:plc:alice123', handle: 'alice.bsky.social' }
    ])
    const text = 'สวัสดี 👨‍👩‍👧‍👦 @alice.bsky.social #ไทย https://example.com/path'
    const facets = await buildBlueskyFacets(text)

    expect(facets).toHaveLength(3)
    expect(facets.map((f) => sliceFacet(text, f.index))).toEqual([
      '@alice.bsky.social',
      '#ไทย',
      'https://example.com/path'
    ])
    expect(facets[0].features).toEqual([
      { $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:alice123' }
    ])
    expect(facets[1].features).toEqual([
      { $type: 'app.bsky.richtext.facet#tag', tag: 'ไทย' }
    ])
    expect(facets[2].features).toEqual([
      {
        $type: 'app.bsky.richtext.facet#link',
        uri: 'https://example.com/path'
      }
    ])
  })

  it('handles URLs at the end of sentences and preserves balanced parentheses', async () => {
    const text =
      'See (https://en.wikipedia.org/wiki/Foo_(bar)) and https://example.com/end.'
    const facets = await buildBlueskyFacets(text)

    expect(facets).toHaveLength(2)
    expect(facets.map((f) => sliceFacet(text, f.index))).toEqual([
      'https://en.wikipedia.org/wiki/Foo_(bar)',
      'https://example.com/end'
    ])
    expect(facets[0].features).toEqual([
      {
        $type: 'app.bsky.richtext.facet#link',
        uri: 'https://en.wikipedia.org/wiki/Foo_(bar)'
      }
    ])
    expect(facets[1].features).toEqual([
      {
        $type: 'app.bsky.richtext.facet#link',
        uri: 'https://example.com/end'
      }
    ])
  })

  it('resolves mentions case-insensitively and leaves unresolved mentions as plain text', async () => {
    vi.mocked(getPublicProfiles).mockResolvedValue([
      { did: 'did:plc:known', handle: 'Alice.Bsky.Social' }
    ])
    const text =
      'Hi @ALICE.bsky.social and @ghost.bsky.social (email user@example.com)'
    const facets = await buildBlueskyFacets(text)

    expect(getPublicProfiles).toHaveBeenCalledTimes(1)
    expect(getPublicProfiles).toHaveBeenCalledWith([
      'alice.bsky.social',
      'ghost.bsky.social'
    ])
    expect(facets).toHaveLength(1)
    expect(sliceFacet(text, facets[0].index)).toBe('@ALICE.bsky.social')
    expect(facets[0].features).toEqual([
      { $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:known' }
    ])
  })

  it('handles overlapping URL/mention/tag spans and adjacent facets', async () => {
    vi.mocked(getPublicProfiles).mockResolvedValue([
      { did: 'did:plc:bob', handle: 'bob.bsky.social' }
    ])
    const text =
      'https://example.com/@alice.bsky.social#frag (@bob.bsky.social) #one #two #123'
    const facets = await buildBlueskyFacets(text)

    // Only @bob.bsky.social is queried: @alice.bsky.social sits inside the URL.
    expect(getPublicProfiles).toHaveBeenCalledWith(['bob.bsky.social'])
    expect(facets.map((f) => sliceFacet(text, f.index))).toEqual([
      'https://example.com/@alice.bsky.social#frag',
      '@bob.bsky.social',
      '#one',
      '#two'
    ])
    expect(facets.map((f) => f.features[0])).toEqual([
      {
        $type: 'app.bsky.richtext.facet#link',
        uri: 'https://example.com/@alice.bsky.social#frag'
      },
      { $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:bob' },
      { $type: 'app.bsky.richtext.facet#tag', tag: 'one' },
      { $type: 'app.bsky.richtext.facet#tag', tag: 'two' }
    ])
  })

  it('does not treat Fediverse double-@ mentions as Bluesky handle mentions', async () => {
    const text = 'Reply to @alice.bsky.social@bsky.app'
    const facets = await buildBlueskyFacets(text)

    expect(getPublicProfiles).not.toHaveBeenCalled()
    expect(facets).toEqual([])
  })
})
