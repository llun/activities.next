/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import {
  addFeaturedTag,
  getFeaturedTagSuggestions,
  getFeaturedTags,
  removeFeaturedTag
} from '@/lib/client'
import type { FeaturedTag } from '@/lib/types/mastodon/featuredTag'

import { FeaturedTagsEditor } from './FeaturedTagsEditor'

jest.mock('@/lib/client', () => ({
  getFeaturedTags: jest.fn(),
  getFeaturedTagSuggestions: jest.fn(),
  addFeaturedTag: jest.fn(),
  removeFeaturedTag: jest.fn()
}))

const mockGetFeaturedTags = getFeaturedTags as jest.Mock
const mockGetSuggestions = getFeaturedTagSuggestions as jest.Mock
const mockAddFeaturedTag = addFeaturedTag as jest.Mock
const mockRemoveFeaturedTag = removeFeaturedTag as jest.Mock

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

describe('FeaturedTagsEditor', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetFeaturedTags.mockResolvedValue([])
    mockGetSuggestions.mockResolvedValue([])
  })

  it('renders the loaded tags with post count and last-posted date', async () => {
    mockGetFeaturedTags.mockResolvedValue([buildTag()])
    render(<FeaturedTagsEditor />)

    expect(await screen.findByText('#running')).toBeInTheDocument()
    expect(
      screen.getByText('128 posts · last posted on Jun 5, 2026')
    ).toBeInTheDocument()
    expect(screen.getByText('1 of 10 featured')).toBeInTheDocument()
  })

  it('shows the empty state when the account has no featured tags', async () => {
    render(<FeaturedTagsEditor />)
    expect(
      await screen.findByText('No featured hashtags yet')
    ).toBeInTheDocument()
  })

  it('clears the loading state and shows an error when the initial load fails', async () => {
    mockGetFeaturedTags.mockRejectedValue(new Error('network'))
    render(<FeaturedTagsEditor />)

    // The skeleton must not get stuck: a load error renders instead of the
    // misleading "no featured hashtags yet" empty state.
    expect(
      await screen.findByText(
        'Couldn’t load your featured hashtags. Please refresh to try again.'
      )
    ).toBeInTheDocument()
    expect(
      screen.queryByText('No featured hashtags yet')
    ).not.toBeInTheDocument()
  })

  it('still shows loaded tags when only the suggestions request fails', async () => {
    mockGetFeaturedTags.mockResolvedValue([buildTag({ name: 'running' })])
    mockGetSuggestions.mockRejectedValue(new Error('network'))
    render(<FeaturedTagsEditor />)

    // Suggestions are best-effort: their failure must not blank the editor.
    expect(await screen.findByText('#running')).toBeInTheDocument()
    expect(
      screen.queryByText(
        'Couldn’t load your featured hashtags. Please refresh to try again.'
      )
    ).not.toBeInTheDocument()
  })

  it('renders "no posts yet" when last_status_at is null', async () => {
    mockGetFeaturedTags.mockResolvedValue([
      buildTag({ name: 'trailrun', statuses_count: '0', last_status_at: null })
    ])
    render(<FeaturedTagsEditor />)
    expect(
      await screen.findByText('0 posts · no posts yet')
    ).toBeInTheDocument()
  })

  it('features a hashtag and shows a success message', async () => {
    mockAddFeaturedTag.mockResolvedValue({
      tag: buildTag({ id: 't9', name: 'cycling', statuses_count: '5' })
    })
    render(<FeaturedTagsEditor />)
    await screen.findByText('No featured hashtags yet')

    fireEvent.change(screen.getByLabelText('Add a hashtag'), {
      target: { value: 'cycling' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByText('#cycling')).toBeInTheDocument()
    expect(mockAddFeaturedTag).toHaveBeenCalledWith('cycling')
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
    render(<FeaturedTagsEditor />)
    await screen.findByText('No featured hashtags yet')

    fireEvent.change(screen.getByLabelText('Add a hashtag'), {
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

  it('blocks an already-featured tag client-side', async () => {
    mockGetFeaturedTags.mockResolvedValue([buildTag({ name: 'running' })])
    render(<FeaturedTagsEditor />)
    await screen.findByText('#running')

    fireEvent.change(screen.getByLabelText('Add a hashtag'), {
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
    render(<FeaturedTagsEditor />)
    await screen.findByText('No featured hashtags yet')

    fireEvent.change(screen.getByLabelText('Add a hashtag'), {
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
    render(<FeaturedTagsEditor />)
    await screen.findByText('#tag0')

    expect(screen.getByText('10 of 10 featured')).toBeInTheDocument()
    expect(screen.getByLabelText('Add a hashtag')).toBeDisabled()
    expect(
      screen.getByText(
        'You can feature up to 10 hashtags. Remove one to add another.'
      )
    ).toBeInTheDocument()
  })

  it('removes a featured tag', async () => {
    mockGetFeaturedTags.mockResolvedValue([buildTag({ name: 'running' })])
    mockRemoveFeaturedTag.mockResolvedValue(true)
    render(<FeaturedTagsEditor />)
    await screen.findByText('#running')

    fireEvent.click(screen.getByRole('button', { name: 'Remove #running' }))

    await waitFor(() =>
      expect(screen.queryByText('#running')).not.toBeInTheDocument()
    )
    expect(mockRemoveFeaturedTag).toHaveBeenCalledWith('t1')
    expect(
      screen.getByText('#running is no longer featured.')
    ).toBeInTheDocument()
  })

  it('keeps the row and re-enables remove when the remove call fails', async () => {
    mockGetFeaturedTags.mockResolvedValue([buildTag({ name: 'running' })])
    mockRemoveFeaturedTag.mockResolvedValue(false)
    render(<FeaturedTagsEditor />)
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
    render(<FeaturedTagsEditor />)
    await screen.findByText('No featured hashtags yet')

    fireEvent.focus(screen.getByLabelText('Add a hashtag'))
    const suggestion = await screen.findByText('#gravel')
    fireEvent.mouseDown(suggestion)

    await waitFor(() =>
      expect(mockAddFeaturedTag).toHaveBeenCalledWith('gravel')
    )
  })
})
