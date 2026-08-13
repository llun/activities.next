/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import {
  createFitnessGearComponent,
  deleteFitnessGearComponent,
  replaceFitnessGearComponent
} from '@/lib/client'
import type { GearComponentEntity } from '@/lib/services/fitness-gears/gearEntities'

import { GearComponentsCard } from './GearComponentsCard'

vi.mock('@/lib/client', () => ({
  createFitnessGearComponent: vi.fn(),
  deleteFitnessGearComponent: vi.fn(),
  replaceFitnessGearComponent: vi.fn()
}))

const mockCreateFitnessGearComponent =
  createFitnessGearComponent as jest.MockedFunction<
    typeof createFitnessGearComponent
  >
const mockDeleteFitnessGearComponent =
  deleteFitnessGearComponent as jest.MockedFunction<
    typeof deleteFitnessGearComponent
  >
const mockReplaceFitnessGearComponent =
  replaceFitnessGearComponent as jest.MockedFunction<
    typeof replaceFitnessGearComponent
  >

const createComponent = (
  overrides: Partial<GearComponentEntity> = {}
): GearComponentEntity => ({
  id: 'component-1',
  gearId: 'gear-1',
  componentType: 'Chain',
  brand: 'Shimano',
  model: 'HG701',
  addedAt: Date.UTC(2024, 0, 15),
  removedAt: null,
  serviceDistanceMeters: null,
  distanceMeters: 2450000,
  activityCount: 82,
  ...overrides
})

const renderCard = (components: GearComponentEntity[], onChanged = vi.fn()) => {
  render(
    <GearComponentsCard
      gearId="gear-1"
      components={components}
      onChanged={onChanged}
    />
  )
  return onChanged
}

describe('GearComponentsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateFitnessGearComponent.mockResolvedValue(createComponent())
    mockDeleteFitnessGearComponent.mockResolvedValue(undefined)
    mockReplaceFitnessGearComponent.mockResolvedValue({
      retired: createComponent({ removedAt: Date.UTC(2025, 5, 1) }),
      replacement: createComponent({ id: 'component-2' })
    })
  })

  it('renders the header with the installed count', () => {
    renderCard([createComponent(), createComponent({ id: 'c2' })])

    expect(
      screen.getByRole('heading', { name: 'Components' })
    ).toBeInTheDocument()
    expect(screen.getByText('2 installed')).toBeInTheDocument()
  })

  it('shows the empty state when there is nothing installed', () => {
    renderCard([])

    expect(
      screen.getByText(
        'No components yet. Add the parts you want to track and each one accrues distance from its added date.'
      )
    ).toBeInTheDocument()
  })

  it('renders the component row with its distance and dates', () => {
    renderCard([createComponent()])

    expect(screen.getByText('Chain')).toBeInTheDocument()
    expect(screen.getByText('Shimano')).toBeInTheDocument()
    expect(screen.getByText('HG701')).toBeInTheDocument()
    expect(screen.getByText('2,450.0 km')).toBeInTheDocument()
    expect(screen.getByText('Jan 15, 2024')).toBeInTheDocument()
    // No removal date on an installed component.
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('renders "Since beginning" when a component has no added date', () => {
    renderCard([createComponent({ addedAt: null })])

    expect(screen.getByText('Since beginning')).toBeInTheDocument()
  })

  it.each([
    {
      description: 'renders the remaining interval below 85%',
      distanceMeters: 2000000,
      caption: 'of 5,000 km'
    },
    {
      description: 'warns at 85% of the interval',
      distanceMeters: 4300000,
      caption: 'due soon'
    },
    {
      description: 'flags an overdue service',
      distanceMeters: 5500000,
      caption: 'replace due'
    }
  ])('$description', ({ distanceMeters, caption }) => {
    renderCard([
      createComponent({ distanceMeters, serviceDistanceMeters: 5000000 })
    ])

    expect(screen.getByText(caption)).toBeInTheDocument()
  })

  it('renders no wear caption without a service interval', () => {
    renderCard([createComponent({ serviceDistanceMeters: null })])

    expect(screen.queryByText(/^of /)).not.toBeInTheDocument()
    expect(screen.queryByText('due soon')).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('exposes the wear bar as a labelled progressbar', () => {
    renderCard([
      createComponent({
        distanceMeters: 2500000,
        serviceDistanceMeters: 5000000
      })
    ])

    const bar = screen.getByRole('progressbar', { name: 'Chain wear' })
    expect(bar).toHaveAttribute('aria-valuenow', '50')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
    expect(bar).toHaveAttribute('aria-valuetext', '50% of service interval')
  })

  it('caps an overdue progressbar at its maximum and reports the real wear', () => {
    renderCard([
      createComponent({
        distanceMeters: 9000000,
        serviceDistanceMeters: 5000000
      })
    ])

    const bar = screen.getByRole('progressbar', { name: 'Chain wear' })
    // aria-valuenow has to stay within min/max; the real number is the text.
    expect(bar).toHaveAttribute('aria-valuenow', '100')
    expect(bar).toHaveAttribute('aria-valuetext', '180% of service interval')
  })

  it('replaces an installed component and refetches', async () => {
    const onChanged = renderCard([createComponent()])

    fireEvent.click(screen.getByRole('button', { name: 'Replace' }))

    await waitFor(() =>
      expect(mockReplaceFitnessGearComponent).toHaveBeenCalledWith(
        'gear-1',
        'component-1'
      )
    )
    expect(onChanged).toHaveBeenCalled()
  })

  it('hides replaced components behind a toggle', () => {
    renderCard([
      createComponent(),
      createComponent({
        id: 'component-old',
        componentType: 'Cassette',
        removedAt: Date.UTC(2025, 5, 1)
      })
    ])

    expect(screen.getByText('1 installed')).toBeInTheDocument()
    expect(screen.queryByText('Cassette')).not.toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Show 1 replaced component' })
    )

    expect(screen.getByText('Cassette')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Hide replaced components' })
    ).toBeInTheDocument()
  })

  it('pluralises the replaced-components toggle', () => {
    renderCard([
      createComponent({ id: 'a', removedAt: 1 }),
      createComponent({ id: 'b', removedAt: 2 })
    ])

    expect(
      screen.getByRole('button', { name: 'Show 2 replaced components' })
    ).toBeInTheDocument()
  })

  it('requires a second click to delete a replaced component', async () => {
    const onChanged = renderCard([
      createComponent({ removedAt: Date.UTC(2025, 5, 1) })
    ])

    fireEvent.click(
      screen.getByRole('button', { name: 'Show 1 replaced component' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(mockDeleteFitnessGearComponent).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() =>
      expect(mockDeleteFitnessGearComponent).toHaveBeenCalledWith(
        'gear-1',
        'component-1'
      )
    )
    expect(onChanged).toHaveBeenCalled()
  })

  it('disarms a pending delete when the replaced rows are hidden and shown again', async () => {
    renderCard([createComponent({ removedAt: Date.UTC(2025, 5, 1) })])

    fireEvent.click(
      screen.getByRole('button', { name: 'Show 1 replaced component' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(
      screen.getByRole('button', { name: 'Confirm delete' })
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Hide replaced components' })
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Show 1 replaced component' })
    )

    // The row comes back unarmed, so the next click confirms nothing.
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(mockDeleteFitnessGearComponent).not.toHaveBeenCalled()
  })

  it('arms only one row at a time', () => {
    renderCard([
      createComponent({ id: 'component-a', removedAt: Date.UTC(2025, 5, 1) }),
      createComponent({
        id: 'component-b',
        componentType: 'Cassette',
        removedAt: Date.UTC(2025, 5, 2)
      })
    ])

    fireEvent.click(
      screen.getByRole('button', { name: 'Show 2 replaced components' })
    )
    const [rowA, rowB] = screen.getAllByRole('button', { name: 'Delete' })

    fireEvent.click(rowA)
    expect(
      screen.getAllByRole('button', { name: 'Confirm delete' })
    ).toHaveLength(1)

    fireEvent.click(rowB)
    const confirming = screen.getAllByRole('button', { name: 'Confirm delete' })
    expect(confirming).toHaveLength(1)
    expect(confirming[0]).toBe(rowB)
    expect(mockDeleteFitnessGearComponent).not.toHaveBeenCalled()
  })

  it('surfaces a replace failure', async () => {
    mockReplaceFitnessGearComponent.mockRejectedValue(
      new Error('Component already replaced')
    )
    const onChanged = renderCard([createComponent()])

    fireEvent.click(screen.getByRole('button', { name: 'Replace' }))

    expect(
      await screen.findByText('Component already replaced')
    ).toBeInTheDocument()
    expect(onChanged).not.toHaveBeenCalled()
    // The row's own action comes back so the failure can be retried.
    expect(screen.getByRole('button', { name: 'Replace' })).toBeEnabled()
  })

  it('surfaces a delete failure', async () => {
    mockDeleteFitnessGearComponent.mockRejectedValue(
      new Error('Component not found')
    )
    const onChanged = renderCard([
      createComponent({ removedAt: Date.UTC(2025, 5, 1) })
    ])

    fireEvent.click(
      screen.getByRole('button', { name: 'Show 1 replaced component' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))

    expect(await screen.findByText('Component not found')).toBeInTheDocument()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('adds a component with no added date and no reminder', async () => {
    const onChanged = renderCard([])

    fireEvent.click(screen.getByRole('button', { name: 'Add component' }))
    fireEvent.change(screen.getByLabelText('Component type'), {
      target: { value: 'Cassette' }
    })
    fireEvent.change(screen.getByLabelText('Brand'), {
      target: { value: 'SRAM' }
    })
    fireEvent.change(screen.getByLabelText('Model'), {
      target: { value: 'XG-1275' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save component' }))

    await waitFor(() =>
      expect(mockCreateFitnessGearComponent).toHaveBeenCalledTimes(1)
    )
    expect(mockCreateFitnessGearComponent).toHaveBeenCalledWith('gear-1', {
      componentType: 'Cassette',
      brand: 'SRAM',
      model: 'XG-1275',
      addedAt: undefined,
      serviceDistanceMeters: null
    })
    expect(onChanged).toHaveBeenCalled()
  })

  it('sends the added date and the service interval in meters', async () => {
    renderCard([])

    fireEvent.click(screen.getByRole('button', { name: 'Add component' }))
    fireEvent.change(screen.getByLabelText('Added on'), {
      target: { value: 'date' }
    })
    fireEvent.change(screen.getByLabelText('Added date'), {
      target: { value: '2024-03-01' }
    })
    fireEvent.change(screen.getByLabelText('Service reminder'), {
      target: { value: '5000' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save component' }))

    await waitFor(() =>
      expect(mockCreateFitnessGearComponent).toHaveBeenCalledTimes(1)
    )
    expect(mockCreateFitnessGearComponent.mock.calls[0][1]).toMatchObject({
      addedAt: Date.UTC(2024, 2, 1),
      serviceDistanceMeters: 5000000
    })
  })

  it('saves when the add panel is submitted from a text field', async () => {
    renderCard([])

    fireEvent.click(screen.getByRole('button', { name: 'Add component' }))
    fireEvent.change(screen.getByLabelText('Brand'), {
      target: { value: 'SRAM' }
    })
    // Enter in an input submits the form it belongs to; the panel used to be a
    // plain div, where the same key press did nothing at all.
    fireEvent.submit(screen.getByRole('form', { name: 'Add component' }))

    await waitFor(() =>
      expect(mockCreateFitnessGearComponent).toHaveBeenCalledTimes(1)
    )
    expect(mockCreateFitnessGearComponent.mock.calls[0][1]).toMatchObject({
      brand: 'SRAM'
    })
  })

  it('only shows the date input when "Specify date" is selected', () => {
    renderCard([])

    fireEvent.click(screen.getByRole('button', { name: 'Add component' }))
    expect(screen.queryByLabelText('Added date')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Added on'), {
      target: { value: 'date' }
    })
    expect(screen.getByLabelText('Added date')).toBeInTheDocument()
  })

  it('closes the add form on cancel', () => {
    renderCard([])

    fireEvent.click(screen.getByRole('button', { name: 'Add component' }))
    expect(screen.getByLabelText('Component type')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Component type')).not.toBeInTheDocument()
  })

  it('surfaces a save failure', async () => {
    mockCreateFitnessGearComponent.mockRejectedValue(
      new Error('Component type is required')
    )
    renderCard([])

    fireEvent.click(screen.getByRole('button', { name: 'Add component' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save component' }))

    await waitFor(() =>
      expect(screen.getByText('Component type is required')).toBeInTheDocument()
    )
  })

  // Mirrors the pinned-column guards in GearListView.test.tsx. This table's
  // rows are inert, so it uses the non-hover variant — and its replaced-row dim
  // has to sit on a descendant, not the pinned cell, because `opacity` fades an
  // element's background along with its text.
  describe('pinned first column', () => {
    const getTypeCell = (componentType: string) =>
      screen.getByText(componentType).closest('td')

    it('pins the type column on an opaque surface', () => {
      renderCard([createComponent()])

      expect(getTypeCell('Chain')).toHaveClass(
        'sticky',
        'left-0',
        'bg-background'
      )
    })

    it('pins the type column header too', () => {
      renderCard([createComponent()])

      expect(screen.getByText('Type').closest('th')).toHaveClass(
        'sticky',
        'left-0',
        'bg-background'
      )
    })

    it('leaves the pinned cell unlit, since the rows are not clickable', () => {
      renderCard([createComponent()])

      // The hover variant belongs only on a row that has its own `hover:` and
      // the `group` class; on an inert row it would light this column alone.
      expect(getTypeCell('Chain')?.className).not.toContain('group-hover:')
    })

    it('dims a replaced component through its cells so the pinned column stays opaque', () => {
      renderCard([createComponent({ removedAt: Date.UTC(2025, 2, 15) })])

      fireEvent.click(
        screen.getByRole('button', { name: /^Show 1 replaced component/ })
      )

      const cell = getTypeCell('Chain')
      expect(cell?.closest('tr')).not.toHaveClass('opacity-60')
      expect(cell).not.toHaveClass('opacity-60')
      expect(cell?.querySelector('.opacity-60')).not.toBeNull()
    })
  })
})
