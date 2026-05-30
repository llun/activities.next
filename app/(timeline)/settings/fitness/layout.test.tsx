/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'
import { usePathname } from 'next/navigation'

import {
  PageHeader,
  PageHeaderSectionProvider
} from '@/lib/components/page-header'

import Layout from './layout'

jest.mock('next/navigation', () => ({
  usePathname: jest.fn()
}))

const renderLayout = () =>
  render(
    <PageHeaderSectionProvider>
      <Layout>
        <PageHeader title="Fitness" description="Fitness file storage." />
        <div>content</div>
      </Layout>
    </PageHeaderSectionProvider>
  )

describe('Fitness Settings Layout', () => {
  it('marks the active fitness sub-tab as the current page', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/settings/fitness/privacy')
    renderLayout()

    const subnav = screen.getByRole('navigation', { name: 'Fitness settings' })
    expect(
      within(subnav).getByRole('link', { name: 'Privacy' })
    ).toHaveAttribute('aria-current', 'page')
    expect(
      within(subnav).getByRole('link', { name: 'General' })
    ).not.toHaveAttribute('aria-current')
  })

  it('renders the page header above the segmented sub-nav, like other settings pages', () => {
    ;(usePathname as jest.Mock).mockReturnValue('/settings/fitness/general')
    renderLayout()

    const heading = screen.getByRole('heading', { name: 'Fitness' })
    const subnav = screen.getByRole('navigation', { name: 'Fitness settings' })

    // The title must come before the sub-nav in document order so the fitness
    // pages lead with their header just like every other settings page.
    expect(
      heading.compareDocumentPosition(subnav) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })
})
