import { getMastodonPreviewCard } from '@/lib/services/mastodon/getMastodonPreviewCard'
import { StatusLinkPreview } from '@/lib/types/domain/status'
import { PreviewCard } from '@/lib/types/mastodon/previewCard'

const full: StatusLinkPreview = {
  url: 'https://example.com/article',
  title: 'An article',
  description: 'About things',
  type: 'link',
  siteName: 'Example',
  authorName: 'Ada',
  authorUrl: 'https://example.com/ada',
  imageUrl: 'https://cdn.example.com/hero.jpg',
  imageWidth: 1200,
  imageHeight: 630,
  publishedAt: 1700000000000
}

describe('getMastodonPreviewCard', () => {
  it('returns null when the status has no card', () => {
    expect(getMastodonPreviewCard(null)).toBeNull()
    expect(getMastodonPreviewCard(undefined)).toBeNull()
  })

  it('maps every field of a complete card', () => {
    const card = getMastodonPreviewCard(full)

    expect(card).toMatchObject({
      url: 'https://example.com/article',
      title: 'An article',
      description: 'About things',
      type: 'link',
      provider_name: 'Example',
      provider_url: '',
      author_name: 'Ada',
      author_url: 'https://example.com/ada',
      image: 'https://cdn.example.com/hero.jpg',
      width: 1200,
      height: 630
    })
  })

  // The Mastodon PreviewCard schema declares every string field non-nullable
  // and Status.parse runs per status, so a card missing one throws inside the
  // per-status handler — which drops the whole status from the timeline rather
  // than just losing the card. Empty-string defaults are what prevent that.
  it('produces a card that satisfies the Mastodon schema when everything optional is absent', () => {
    const card = getMastodonPreviewCard({
      url: 'https://example.com/bare',
      title: 'Bare'
    })

    expect(() => PreviewCard.parse(card)).not.toThrow()
    expect(card).toMatchObject({
      description: '',
      author_name: '',
      author_url: '',
      provider_name: '',
      provider_url: '',
      html: '',
      embed_url: '',
      width: 0,
      height: 0,
      image: null,
      blurhash: null
    })
  })

  it('produces a card that satisfies the Mastodon schema when everything is null', () => {
    const card = getMastodonPreviewCard({
      url: 'https://example.com/nulls',
      title: 'Nulls',
      description: null,
      siteName: null,
      authorName: null,
      authorUrl: null,
      imageUrl: null,
      imageWidth: null,
      imageHeight: null,
      publishedAt: null
    })

    expect(() => PreviewCard.parse(card)).not.toThrow()
  })

  it('validates a complete card against the Mastodon schema', () => {
    expect(() => PreviewCard.parse(getMastodonPreviewCard(full))).not.toThrow()
  })

  it('never emits embeddable html, so no remote markup reaches a client', () => {
    expect(getMastodonPreviewCard(full)?.html).toBe('')
    expect(getMastodonPreviewCard(full)?.embed_url).toBe('')
  })

  it('defaults an unknown card type to link', () => {
    expect(
      getMastodonPreviewCard({ ...full, type: 'something-else' })?.type
    ).toBe('link')
  })

  it.each([
    { description: 'keeps link', type: 'link' },
    { description: 'keeps photo', type: 'photo' },
    { description: 'keeps video', type: 'video' },
    { description: 'keeps rich', type: 'rich' }
  ])('$description', ({ type }) => {
    expect(getMastodonPreviewCard({ ...full, type })?.type).toBe(type)
  })
})
