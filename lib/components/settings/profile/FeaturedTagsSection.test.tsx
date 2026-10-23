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
import type { FeaturedTag } from '@/lib/types/mastodon/featuredTag'

import { FeaturedTagsSection } from './FeaturedTagsSection'

vi.mock('@/lib/client', () => ({
  getFeaturedTags: vi.fn(),
  getFeaturedTagSuggestions: vi.fn(),
  addFeaturedTag: vi.fn(),
  removeFeaturedTag: vi.fn()
}))

const TAG: FeaturedTag = {
  id: 't1',
  name: 'birds',
  url: 'https://llun.test/@anna/tagged/birds',
  statuses_count: '4',
  last_status_at: '2026-06-05'
}

describe('FeaturedTagsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getFeaturedTags).mockResolvedValue([TAG])
    vi.mocked(getFeaturedTagSuggestions).mockResolvedValue([])
    vi.mocked(removeFeaturedTag).mockResolvedValue(true)
  })

  describe('embedded', () => {
    it('is one Featured hashtags section with the anchor the redirect lands on', async () => {
      render(<FeaturedTagsSection variant="embedded" />)

      const section = screen.getByRole('region', { name: 'Featured hashtags' })
      expect(section).toHaveAttribute('id', 'featured-hashtags')
      expect(
        screen.getByText(/Tags you post about most, shown under your bio/)
      ).toBeInTheDocument()
      expect(await screen.findByText('#birds')).toBeInTheDocument()
      expect(screen.getByText('1 of 10 featured')).toBeInTheDocument()
      // One heading, not the page's two.
      expect(screen.queryByText('Add a hashtag', { selector: 'h2' })).toBeNull()
      expect(
        screen.queryByText('Your featured hashtags', { selector: 'h2' })
      ).toBeNull()
    })

    it('keeps its own immediate save for removing a tag', async () => {
      render(<FeaturedTagsSection variant="embedded" />)
      await screen.findByText('#birds')

      fireEvent.click(screen.getByRole('button', { name: 'Remove #birds' }))

      await waitFor(() => expect(removeFeaturedTag).toHaveBeenCalledWith('t1'))
      await screen.findByText('No featured hashtags yet')
    })

    it('adds a tag at once', async () => {
      vi.mocked(getFeaturedTags).mockResolvedValue([])
      vi.mocked(addFeaturedTag).mockResolvedValue({
        tag: { ...TAG, id: 't2', name: 'owls' }
      })
      render(<FeaturedTagsSection variant="embedded" />)
      await screen.findByText('No featured hashtags yet')

      const input = screen.getByLabelText('Add a hashtag')
      fireEvent.change(input, { target: { value: '#owls' } })
      fireEvent.submit(input.closest('form') as HTMLFormElement)

      await screen.findByText('#owls')
      expect(addFeaturedTag).toHaveBeenCalledWith('owls')
    })
  })

  describe('page', () => {
    it('is the standalone page’s two sections, without the anchor', async () => {
      render(<FeaturedTagsSection />)

      expect(
        screen.getByRole('region', { name: 'Add a hashtag' })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('region', { name: 'Your featured hashtags' })
      ).toBeInTheDocument()
      expect(document.getElementById('featured-hashtags')).toBeNull()
      await screen.findByText('#birds')
    })
  })
})
