/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  GalleryFilterOptionList,
  type GalleryFilterOptionListProps
} from './GalleryFilterOptionList'

describe('GalleryFilterOptionList', () => {
  const defaultProps: GalleryFilterOptionListProps = {
    searchPlaceholder: 'Search places',
    searchAriaLabel: 'Search places',
    anyOption: {
      label: 'Any place',
      count: 42,
      active: true,
      onSelect: vi.fn()
    },
    items: [
      {
        id: 'place-1',
        label: 'Box Hill',
        subLabel: 'Surrey, England',
        count: 15,
        active: false,
        onSelect: vi.fn(),
        searchTerms: ['Surrey Hills', 'North Downs']
      },
      {
        id: 'place-2',
        label: 'Richmond Park',
        subLabel: 'London',
        count: 27,
        active: false,
        onSelect: vi.fn()
      },
      {
        id: 'place-3',
        label: 'Café de Flore',
        subLabel: 'Paris',
        count: 5,
        active: false,
        onSelect: vi.fn()
      }
    ],
    noneOption: {
      label: 'No place',
      count: 3,
      active: false,
      onSelect: vi.fn()
    }
  }

  it('renders anyOption, all items, and noneOption with counts and sublabels', () => {
    render(<GalleryFilterOptionList {...defaultProps} />)

    expect(
      screen.getByRole('group', { name: 'Search places options' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
    expect(screen.getByText('Any place')).toBeInTheDocument()
    expect(screen.getByText('Box Hill')).toBeInTheDocument()
    expect(screen.getByText('Surrey, England')).toBeInTheDocument()
    expect(screen.getByText('Richmond Park')).toBeInTheDocument()
    expect(screen.getByText('No place')).toBeInTheDocument()

    // Counts
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('15')).toBeInTheDocument()
    expect(screen.getByText('27')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()

    // Separator between items and noneOption
  })

  it('indicates the active option via aria-pressed', () => {
    render(<GalleryFilterOptionList {...defaultProps} />)

    const anyButton = screen.getByRole('button', { name: /Any place/ })
    expect(anyButton).toHaveAttribute('aria-pressed', 'true')

    const boxHillButton = screen.getByRole('button', { name: /Box Hill/ })
    expect(boxHillButton).toHaveAttribute('aria-pressed', 'false')
  })

  it('calls onSelect when an item, anyOption, or noneOption is clicked', () => {
    const onSelectAny = vi.fn()
    const onSelectItem = vi.fn()
    const onSelectNone = vi.fn()

    render(
      <GalleryFilterOptionList
        {...defaultProps}
        anyOption={{
          ...defaultProps.anyOption,
          active: false,
          onSelect: onSelectAny
        }}
        items={[
          {
            ...defaultProps.items[0],
            active: false,
            onSelect: onSelectItem
          }
        ]}
        noneOption={{
          ...defaultProps.noneOption!,
          active: false,
          onSelect: onSelectNone
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Box Hill/ }))
    expect(onSelectItem).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /Any place/ }))
    expect(onSelectAny).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /No place/ }))
    expect(onSelectNone).toHaveBeenCalledTimes(1)
  })

  it('filters items client-side by label (case-insensitive)', () => {
    render(<GalleryFilterOptionList {...defaultProps} />)

    const searchInput = screen.getByPlaceholderText('Search places')
    fireEvent.change(searchInput, { target: { value: 'richmond' } })

    expect(screen.getByText('Richmond Park')).toBeInTheDocument()
    expect(screen.queryByText('Box Hill')).not.toBeInTheDocument()
    expect(screen.queryByText('Café de Flore')).not.toBeInTheDocument()
  })

  it('filters items by subLabel', () => {
    render(<GalleryFilterOptionList {...defaultProps} />)

    const searchInput = screen.getByPlaceholderText('Search places')
    fireEvent.change(searchInput, { target: { value: 'London' } })

    expect(screen.getByText('Richmond Park')).toBeInTheDocument()
    expect(screen.queryByText('Box Hill')).not.toBeInTheDocument()
  })

  it('filters items by searchTerms', () => {
    render(<GalleryFilterOptionList {...defaultProps} />)

    const searchInput = screen.getByPlaceholderText('Search places')
    fireEvent.change(searchInput, { target: { value: 'North Downs' } })

    expect(screen.getByText('Box Hill')).toBeInTheDocument()
    expect(screen.queryByText('Richmond Park')).not.toBeInTheDocument()
  })

  it('filters items accent-insensitively', () => {
    render(<GalleryFilterOptionList {...defaultProps} />)

    const searchInput = screen.getByPlaceholderText('Search places')
    fireEvent.change(searchInput, { target: { value: 'cafe' } })

    expect(screen.getByText('Café de Flore')).toBeInTheDocument()
    expect(screen.queryByText('Box Hill')).not.toBeInTheDocument()
  })

  it('clears search query using the clear button', () => {
    render(<GalleryFilterOptionList {...defaultProps} />)

    const searchInput = screen.getByPlaceholderText('Search places')
    fireEvent.change(searchInput, { target: { value: 'richmond' } })
    expect(screen.queryByText('Box Hill')).not.toBeInTheDocument()

    const clearButton = screen.getByRole('button', { name: 'Clear search' })
    fireEvent.click(clearButton)

    expect(searchInput).toHaveValue('')
    expect(screen.getByText('Box Hill')).toBeInTheDocument()
    expect(screen.getByText('Richmond Park')).toBeInTheDocument()
  })

  it('shows "No matches found" when search yields no results', () => {
    render(<GalleryFilterOptionList {...defaultProps} />)

    const searchInput = screen.getByPlaceholderText('Search places')
    fireEvent.change(searchInput, { target: { value: 'xyznonexistent' } })

    expect(screen.getByText('No matches found')).toBeInTheDocument()
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
  })

  it('omits separator when noneOption is not provided', () => {
    render(<GalleryFilterOptionList {...defaultProps} noneOption={undefined} />)

    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
    expect(screen.queryByText('No place')).not.toBeInTheDocument()
  })
})
