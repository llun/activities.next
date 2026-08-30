/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import {
  PageHeader,
  PageHeaderSectionProvider
} from '@/lib/components/page-header'

describe('PageHeader', () => {
  it('centers the sticky header title row at the unified max-w-content width', () => {
    const { container } = render(
      <PageHeader title="Timeline" description="Latest posts" />
    )

    // The sticky chrome breaks out to the full area beside the sidebar, but the
    // inner title row is centered at the single shared content width so the
    // title lines up with the content column on every (timeline) page. This
    // guards against re-introducing the old per-page width tiers (max-w-2xl /
    // max-w-4xl) or otherwise diverging the header from the content column.
    const innerRow = container.querySelector('.max-w-content')
    expect(innerRow).toBeInTheDocument()
    expect(innerRow).toHaveClass('mx-auto')
    expect(innerRow).toContainElement(
      screen.getByRole('heading', { name: 'Timeline' })
    )
  })

  it('does not impose its own width in section mode (inherits the layout column)', () => {
    const { container } = render(
      <PageHeaderSectionProvider>
        <PageHeader title="General" description="Account settings" />
      </PageHeaderSectionProvider>
    )

    // Section-mode headers render a plain in-panel title block and rely on the
    // (timeline) layout wrapper for max-w-content — they must not re-cap width.
    expect(container.querySelector('.max-w-content')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'General' })).toBeInTheDocument()
  })

  it('stacks actions on mobile when stackActionsOnMobile is true', () => {
    const { container } = render(
      <PageHeader
        title="Lists & Collections"
        description="Private curated timelines"
        stackActionsOnMobile
        actions={<button type="button">New list</button>}
      />
    )

    const flexContainer = container.querySelector('.max-w-content > div')
    expect(flexContainer).toHaveClass('flex-col')
    expect(flexContainer).toHaveClass('sm:flex-row')
    const actionWrapper = screen.getByRole('button', {
      name: 'New list'
    }).parentElement
    expect(actionWrapper).toHaveClass('self-start')
    expect(actionWrapper).toHaveClass('sm:self-center')
  })

  it('stacks actions on mobile in section mode when stackActionsOnMobile is true', () => {
    const { container } = render(
      <PageHeaderSectionProvider>
        <PageHeader
          title="Section"
          description="Description"
          stackActionsOnMobile
          actions={<button type="button">Action</button>}
        />
      </PageHeaderSectionProvider>
    )

    const flexContainer = container.querySelector('.mb-6 > div')
    expect(flexContainer).toHaveClass('flex-col')
    expect(flexContainer).toHaveClass('sm:flex-row')
    const actionWrapper = screen.getByRole('button', {
      name: 'Action'
    }).parentElement
    expect(actionWrapper).toHaveClass('self-start')
    expect(actionWrapper).toHaveClass('sm:self-center')
  })

  it('keeps actions inline by default when stackActionsOnMobile is not set', () => {
    const { container } = render(
      <PageHeader
        title="Lists"
        actions={<button type="button">Action</button>}
      />
    )

    const flexContainer = container.querySelector('.max-w-content > div')
    expect(flexContainer).toHaveClass('items-start')
    expect(flexContainer).toHaveClass('justify-between')
    expect(flexContainer).not.toHaveClass('flex-col')
    const actionWrapper = screen.getByRole('button', {
      name: 'Action'
    }).parentElement
    expect(actionWrapper).toHaveClass('self-center')
    expect(actionWrapper).not.toHaveClass('self-start')
  })
})
