/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import {
  addFeaturedTag,
  getFeaturedTagSuggestions,
  getFeaturedTags,
  removeFeaturedTag
} from '@/lib/client'
import { createDeferred } from '@/lib/testing/deferred'
import type { FeaturedTag } from '@/lib/types/mastodon/featuredTag'

import { FeaturedTagsSection } from './FeaturedTagsSection'

vi.mock('@/lib/client', () => ({
  getFeaturedTags: vi.fn(),
  getFeaturedTagSuggestions: vi.fn(),
  addFeaturedTag: vi.fn(),
  removeFeaturedTag: vi.fn()
}))

const mockGetFeaturedTags = vi.mocked(getFeaturedTags)
const mockGetSuggestions = vi.mocked(getFeaturedTagSuggestions)
const mockAddFeaturedTag = vi.mocked(addFeaturedTag)
const mockRemoveFeaturedTag = vi.mocked(removeFeaturedTag)

const buildTag = (overrides: Partial<FeaturedTag> = {}): FeaturedTag => ({
  id: overrides.id ?? 't1',
  name: overrides.name ?? 'running',
  url: overrides.url ?? 'https://example.test/@anna/tagged/running',
  statuses_count: overrides.statuses_count ?? '128',
  last_status_at:
    overrides.last_status_at === undefined
      ? '2026-06-05'
      : overrides.last_status_at
})

const onActorChanged = vi.fn()

describe('FeaturedTagsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetFeaturedTags.mockResolvedValue([])
    mockGetSuggestions.mockResolvedValue([])
  })

  it('turns the add control and Remove buttons off when disabled', async () => {
    mockGetFeaturedTags.mockResolvedValue([buildTag({ name: 'birds' })])
    render(
      <FeaturedTagsSection
        actorId="actor-1"
        disabled
        onActorChanged={onActorChanged}
      />
    )

    await screen.findByText('#birds')
    expect(screen.getByLabelText('Add a hashtag')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove #birds' })).toBeDisabled()
  })

  it('is one Featured hashtags section with the anchor the redirect lands on', async () => {
    mockGetFeaturedTags.mockResolvedValue([buildTag({ name: 'birds' })])
    render(
      <FeaturedTagsSection actorId="actor-1" onActorChanged={onActorChanged} />
    )

    const section = screen.getByRole('region', { name: 'Featured hashtags' })
    expect(section).toHaveAttribute('id', 'featured-hashtags')
    expect(
      screen.getByText(/Tags you post about most, shown under your bio/)
    ).toBeInTheDocument()
    expect(await screen.findByText('#birds')).toBeInTheDocument()
    // One heading, not the old page's two.
    expect(screen.queryByText('Add a hashtag', { selector: 'h2' })).toBeNull()
    expect(
      screen.queryByText('Your featured hashtags', { selector: 'h2' })
    ).toBeNull()
  })

  it('adds a tag by submitting its own form', async () => {
    mockAddFeaturedTag.mockResolvedValue({
      tag: buildTag({ id: 't2', name: 'owls' })
    })
    render(
      <FeaturedTagsSection actorId="actor-1" onActorChanged={onActorChanged} />
    )
    await screen.findByText('No featured hashtags yet')

    const input = screen.getByRole('textbox', { name: 'Add a hashtag' })
    fireEvent.change(input, { target: { value: '#owls' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)

    await screen.findByText('#owls')
    expect(mockAddFeaturedTag).toHaveBeenCalledWith('owls', 'actor-1')
  })

  it('renders the loaded tags with post count and last-posted date', async () => {
    mockGetFeaturedTags.mockResolvedValue([buildTag()])
    render(
      <FeaturedTagsSection actorId="actor-1" onActorChanged={onActorChanged} />
    )

    expect(await screen.findByText('#running')).toBeInTheDocument()
    expect(
      screen.getByText('128 posts · last posted on Jun 5, 2026')
    ).toBeInTheDocument()
    expect(screen.getByText('1 of 10 featured')).toBeInTheDocument()
  })

  it('shows the empty state when the account has no featured tags', async () => {
    render(
      <FeaturedTagsSection actorId="actor-1" onActorChanged={onActorChanged} />
    )
    expect(
      await screen.findByText('No featured hashtags yet')
    ).toBeInTheDocument()
  })

  it('renders the loading placeholders with the shimmer skeleton utility', async () => {
    // Hold the tags request pending so the assertion really sees the in-flight
    // skeleton — an already-resolved mock collapses the pending render and the
    // settled one into a single flush.
    const pendingTags = createDeferred<FeaturedTag[]>()
    mockGetFeaturedTags.mockReturnValue(pendingTags.promise)

    const { container } = render(
      <FeaturedTagsSection actorId="actor-1" onActorChanged={onActorChanged} />
    )

    // jsdom paints no CSS, so the class is the observable — see
    // app/globals.skeleton.test.ts for the definition guard.
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0)
    expect(container.querySelector('.animate-pulse')).toBeNull()

    pendingTags.resolve([])
    expect(
      await screen.findByText('No featured hashtags yet')
    ).toBeInTheDocument()
  })

  it('clears the loading state and shows an error when the initial load fails', async () => {
    mockGetFeaturedTags.mockRejectedValue(new Error('network'))
    render(
      <FeaturedTagsSection actorId="actor-1" onActorChanged={onActorChanged} />
    )

    // The skeleton must not get stuck: a load error renders instead of the
    // misleading "no featured hashtags yet" empty state.
    expect(
      await screen.findByText('Couldn’t load your featured hashtags')
    ).toBeInTheDocument()
    expect(
      screen.queryByText('No featured hashtags yet')
    ).not.toBeInTheDocument()
  })

  it('retries the load from the error alert', async () => {
    mockGetFeaturedTags.mockRejectedValueOnce(new Error('network'))
    mockGetFeaturedTags.mockResolvedValueOnce([buildTag({ name: 'running' })])
    render(
      <FeaturedTagsSection actorId="actor-1" onActorChanged={onActorChanged} />
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('#running')).toBeInTheDocument()
    expect(
      screen.queryByText('Couldn’t load your featured hashtags')
    ).not.toBeInTheDocument()
  })

  it('points the empty state at the input with its Add hashtag action', async () => {
    mockGetFeaturedTags.mockResolvedValue([])
    render(
      <FeaturedTagsSection actorId="actor-1" onActorChanged={onActorChanged} />
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Add hashtag' }))

    expect(screen.getByRole('textbox', { name: 'Add a hashtag' })).toHaveFocus()
  })

  it('still shows loaded tags when only the suggestions request fails', async () => {
    mockGetFeaturedTags.mockResolvedValue([buildTag({ name: 'running' })])
    mockGetSuggestions.mockRejectedValue(new Error('network'))
    render(
      <FeaturedTagsSection actorId="actor-1" onActorChanged={onActorChanged} />
    )

    // Suggestions are best-effort: their failure must not blank the editor.
    expect(await screen.findByText('#running')).toBeInTheDocument()
    expect(
      screen.queryByText('Couldn’t load your featured hashtags')
    ).not.toBeInTheDocument()
  })

  it('renders "no posts yet" when last_status_at is null', async () => {
    mockGetFeaturedTags.mockResolvedValue([
      buildTag({ name: 'trailrun', statuses_count: '0', last_status_at: null })
    ])
    render(
      <FeaturedTagsSection actorId="actor-1" onActorChanged={onActorChanged} />
    )
    expect(
      await screen.findByText('0 posts · no posts yet')
    ).toBeInTheDocument()
  })

  it('features a hashtag and shows a success message', async () => {
    mockAddFeaturedTag.mockResolvedValue({
      tag: buildTag({ id: 't9', name: 'cycling', statuses_count: '5' })
    })
    render(
      <FeaturedTagsSection actorId="actor-1" onActorChanged={onActorChanged} />
    )
    await screen.findByText('No featured hashtags yet')

    fireEvent.change(screen.getByRole('textbox', { name: 'Add a hashtag' }), {
      target: { value: 'cycling' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByText('#cycling')).toBeInTheDocument()
    expect(mockAddFeaturedTag).toHaveBeenCalledWith('cycling', 'actor-1')
    expect(
      screen.getByText('#cycling is now featured on your profile.')
    ).toBeInTheDocument()
  })

  it.each([
    { description: 'a name with spaces or symbols', value: 'no spaces' },
    // All-numeric / Unicode names pass the server regex but can't be rendered
    // by the app's ASCII-only /tags/<name> route, so the editor rejects them.
    { description: 'an all-numeric name', value: '2024' }
  ])('rejects $description without calling the API', async ({ value }) => {
    render(
      <FeaturedTagsSection actorId="actor-1" onActorChanged={onActorChanged} />
    )
    await screen.findByText('No featured hashtags yet')

    fireEvent.change(screen.getByRole('textbox', { name: 'Add a hashtag' }), {
      target: { value }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(
      screen.getByText(
        'Use letters, numbers, and underscores, and include at least one letter.'
      )
    ).toBeInTheDocument()
    expect(mockAddFeaturedTag).not.toHaveBeenCalled()
  })

  it('rejects a name over the length limit with a length message', async () => {
    render(
      <FeaturedTagsSection actorId="actor-1" onActorChanged={onActorChanged} />
    )
    await screen.findByText('No featured hashtags yet')

    fireEvent.change(screen.getByRole('textbox', { name: 'Add a hashtag' }), {
      target: { value: 'a'.repeat(256) }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(
      screen.getByText('Hashtags can be up to 255 characters.')
    ).toBeInTheDocument()
    expect(mockAddFeaturedTag).not.toHaveBeenCalled()
  })

  it('blocks an already-featured tag client-side', async () => {
    mockGetFeaturedTags.mockResolvedValue([buildTag({ name: 'running' })])
    render(
      <FeaturedTagsSection actorId="actor-1" onActorChanged={onActorChanged} />
    )
    await screen.findByText('#running')

    fireEvent.change(screen.getByRole('textbox', { name: 'Add a hashtag' }), {
      target: { value: '#Running' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(
      screen.getByText('#Running is already featured.')
    ).toBeInTheDocument()
    expect(mockAddFeaturedTag).not.toHaveBeenCalled()
  })

  it('surfaces a server error from the add call', async () => {
    mockAddFeaturedTag.mockResolvedValue({ error: 'Invalid hashtag name' })
    render(
      <FeaturedTagsSection actorId="actor-1" onActorChanged={onActorChanged} />
    )
    await screen.findByText('No featured hashtags yet')

    fireEvent.change(screen.getByRole('textbox', { name: 'Add a hashtag' }), {
      target: { value: 'valid' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByText('Invalid hashtag name')).toBeInTheDocument()
  })

  it('disables the input and shows the helper at the 10-tag limit', async () => {
    mockGetFeaturedTags.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) =>
        buildTag({ id: `t${index}`, name: `tag${index}` })
      )
    )
    render(
      <FeaturedTagsSection actorId="actor-1" onActorChanged={onActorChanged} />
    )
    await screen.findByText('#tag0')

    expect(screen.getByText('10 of 10 featured')).toBeInTheDocument()
    expect(
      screen.getByRole('textbox', { name: 'Add a hashtag' })
    ).toBeDisabled()
    expect(
      screen.getByText(
        'You can feature up to 10 hashtags. Remove one to add another.'
      )
    ).toBeInTheDocument()
  })

  it('removes a featured tag', async () => {
    mockGetFeaturedTags.mockResolvedValue([buildTag({ name: 'running' })])
    mockRemoveFeaturedTag.mockResolvedValue({ removed: true })
    render(
      <FeaturedTagsSection actorId="actor-1" onActorChanged={onActorChanged} />
    )
    await screen.findByText('#running')

    fireEvent.click(screen.getByRole('button', { name: 'Remove #running' }))

    await waitFor(() =>
      expect(screen.queryByText('#running')).not.toBeInTheDocument()
    )
    expect(mockRemoveFeaturedTag).toHaveBeenCalledWith('t1', 'actor-1')
    expect(
      screen.getByText('#running is no longer featured.')
    ).toBeInTheDocument()
  })

  it('keeps the row and re-enables remove when the remove call fails', async () => {
    mockGetFeaturedTags.mockResolvedValue([buildTag({ name: 'running' })])
    mockRemoveFeaturedTag.mockResolvedValue({ removed: false })
    render(
      <FeaturedTagsSection actorId="actor-1" onActorChanged={onActorChanged} />
    )
    await screen.findByText('#running')

    const removeButton = screen.getByRole('button', { name: 'Remove #running' })
    fireEvent.click(removeButton)

    expect(
      await screen.findByText('Couldn’t remove #running. Please try again.')
    ).toBeInTheDocument()
    // The row stays and its remove control is usable again (busy state cleared).
    expect(screen.getByText('#running')).toBeInTheDocument()
    expect(removeButton).not.toBeDisabled()
  })

  it('offers suggestions from the suggestions endpoint and features one on click', async () => {
    mockGetSuggestions.mockResolvedValue([
      { name: 'gravel', url: 'https://example.test/tags/gravel', history: [] }
    ])
    mockAddFeaturedTag.mockResolvedValue({
      tag: buildTag({ id: 't7', name: 'gravel', statuses_count: '3' })
    })
    render(
      <FeaturedTagsSection actorId="actor-1" onActorChanged={onActorChanged} />
    )
    await screen.findByText('No featured hashtags yet')

    fireEvent.focus(screen.getByRole('textbox', { name: 'Add a hashtag' }))
    const suggestion = await screen.findByText('#gravel')
    fireEvent.mouseDown(suggestion)

    await waitFor(() =>
      expect(mockAddFeaturedTag).toHaveBeenCalledWith('gravel', 'actor-1')
    )
  })

  it('reports up when an add finds another profile, and adds nothing', async () => {
    mockAddFeaturedTag.mockResolvedValue({
      error: 'Actor changed',
      actorChanged: true
    })
    render(
      <FeaturedTagsSection actorId="actor-1" onActorChanged={onActorChanged} />
    )
    await screen.findByText('No featured hashtags yet')

    const input = screen.getByLabelText('Add a hashtag')
    fireEvent.change(input, { target: { value: 'owls' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)

    await waitFor(() => expect(onActorChanged).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('#owls')).toBeNull()
  })

  it('reports up when a remove finds another profile, and keeps the row', async () => {
    mockGetFeaturedTags.mockResolvedValue([buildTag({ name: 'running' })])
    mockRemoveFeaturedTag.mockResolvedValue({
      removed: false,
      actorChanged: true
    })
    render(
      <FeaturedTagsSection actorId="actor-1" onActorChanged={onActorChanged} />
    )
    await screen.findByText('#running')

    fireEvent.click(screen.getByRole('button', { name: 'Remove #running' }))

    await waitFor(() => expect(onActorChanged).toHaveBeenCalledTimes(1))
    expect(screen.getByText('#running')).toBeInTheDocument()
  })
})
