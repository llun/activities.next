/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { GearProductLink } from './GearProductLink'

describe('GearProductLink', () => {
  it('shows the hostname rather than the whole URL', () => {
    render(
      <GearProductLink
        productUrl="https://www.moots.com/pages/vamoots-rsl?ref=1"
        onEdit={vi.fn()}
      />
    )

    const link = screen.getByRole('link', { name: 'Product page: moots.com' })
    expect(link).toHaveAttribute(
      'href',
      'https://www.moots.com/pages/vamoots-rsl?ref=1'
    )
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it.each([
    { description: 'no product page', productUrl: null },
    // Both predate the API's validation, and neither may become an `href`: a
    // `javascript:` URL parses to a perfectly good hostname, and a bare
    // hostname would render as a link back to this origin.
    { description: 'a javascript: URL', productUrl: 'javascript:alert(1)' },
    { description: 'a bare hostname', productUrl: 'moots.com' }
  ])('offers to add one for $description', ({ productUrl }) => {
    const onEdit = vi.fn()
    render(<GearProductLink productUrl={productUrl} onEdit={onEdit} />)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'No product page — add one' })
    )
    expect(onEdit).toHaveBeenCalled()
  })

  it('falls back to an em dash where there is no form to open', () => {
    // The gear list renders it without `onEdit`: there is no dialog on that
    // surface to prompt toward, so the prompt would lead nowhere.
    render(<GearProductLink productUrl={null} />)

    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('stops a click from reaching the row it sits in', () => {
    // A gear list row navigates on click; without this the anchor would open
    // the vendor's page and push the gear route behind it.
    const onRowClick = vi.fn()
    const onClick = vi.fn((event: MouseEvent) => event.stopPropagation())
    render(
      <div onClick={onRowClick}>
        <GearProductLink
          productUrl="https://moots.com"
          onClick={onClick as never}
        />
      </div>
    )

    fireEvent.click(screen.getByRole('link'))
    expect(onClick).toHaveBeenCalled()
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('uses the accessible orange for the link text', () => {
    // `text-primary` is 3.37:1 on the card and fails AA as a foreground;
    // `--primary-text` is the hue tuned per theme to clear it.
    render(<GearProductLink productUrl="https://moots.com" onEdit={vi.fn()} />)

    expect(screen.getByRole('link')).toHaveClass('text-primary-text')
  })
})
