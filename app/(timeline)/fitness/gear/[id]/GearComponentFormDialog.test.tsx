/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import {
  createFitnessGearComponent,
  updateFitnessGearComponent
} from '@/lib/client'
import type { GearComponentEntity } from '@/lib/services/fitness-gears/gearEntities'

import { GearComponentFormDialog } from './GearComponentFormDialog'

vi.mock('@/lib/client', () => ({
  createFitnessGearComponent: vi.fn(),
  updateFitnessGearComponent: vi.fn()
}))

const mockCreateFitnessGearComponent =
  createFitnessGearComponent as jest.MockedFunction<
    typeof createFitnessGearComponent
  >
const mockUpdateFitnessGearComponent =
  updateFitnessGearComponent as jest.MockedFunction<
    typeof updateFitnessGearComponent
  >

const createComponent = (
  overrides: Partial<GearComponentEntity> = {}
): GearComponentEntity => ({
  id: 'component-1',
  gearId: 'gear-1',
  componentType: 'Front tire',
  brand: 'Continental',
  model: '5000 AS TR',
  addedAt: Date.UTC(2024, 0, 15),
  removedAt: null,
  serviceDistanceMeters: 5000000,
  distanceMeters: 2450000,
  activityCount: 82,
  productUrl: 'https://continental-tires.com',
  periods: [{ addedAt: Date.UTC(2024, 0, 15), removedAt: null }],
  ...overrides
})

describe('GearComponentFormDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateFitnessGearComponent.mockResolvedValue(createComponent())
    mockUpdateFitnessGearComponent.mockResolvedValue(createComponent())
  })

  it('renders in Add mode when no component is provided', () => {
    render(
      <GearComponentFormDialog
        open={true}
        gearId="gear-1"
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />
    )

    expect(
      screen.getByRole('heading', { name: 'Add a component' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Save component' })
    ).toBeInTheDocument()
  })

  it('renders in Edit mode when a component is provided', () => {
    render(
      <GearComponentFormDialog
        open={true}
        gearId="gear-1"
        component={createComponent()}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />
    )

    expect(
      screen.getByRole('heading', { name: 'Edit component' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Save changes' })
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Brand')).toHaveValue('Continental')
    expect(screen.getByLabelText('Model')).toHaveValue('5000 AS TR')
    expect(screen.getByLabelText('Product page')).toHaveValue(
      'https://continental-tires.com'
    )
    expect(screen.getByLabelText('Service reminder')).toHaveValue('5000')
    expect(screen.getByLabelText('Added on')).toHaveValue('date')
    expect(screen.getByLabelText('Added date')).toHaveValue('2024-01-15')
  })

  it('creates a new component on submit', async () => {
    const onSaved = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <GearComponentFormDialog
        open={true}
        gearId="gear-1"
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />
    )

    fireEvent.change(screen.getByLabelText('Brand'), {
      target: { value: 'Shimano' }
    })
    fireEvent.change(screen.getByLabelText('Model'), {
      target: { value: 'CN-HG901' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save component' }))

    await waitFor(() => {
      expect(mockCreateFitnessGearComponent).toHaveBeenCalledWith('gear-1', {
        componentType: 'Chain',
        brand: 'Shimano',
        model: 'CN-HG901',
        addedAt: undefined,
        serviceDistanceMeters: null,
        productUrl: null
      })
    })
    expect(onSaved).toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('updates an existing component on submit', async () => {
    const onSaved = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <GearComponentFormDialog
        open={true}
        gearId="gear-1"
        component={createComponent()}
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />
    )

    fireEvent.change(screen.getByLabelText('Model'), {
      target: { value: 'Grand Prix 5000 S TR' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(mockUpdateFitnessGearComponent).toHaveBeenCalledWith(
        'gear-1',
        'component-1',
        expect.objectContaining({
          model: 'Grand Prix 5000 S TR'
        })
      )
    })
    expect(onSaved).toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('explicitly sends addedAt: null when changed to beginning', async () => {
    const onSaved = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <GearComponentFormDialog
        open={true}
        gearId="gear-1"
        component={createComponent({ addedAt: Date.UTC(2024, 0, 15) })}
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />
    )

    fireEvent.change(screen.getByLabelText('Added on'), {
      target: { value: 'beginning' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(mockUpdateFitnessGearComponent).toHaveBeenCalledWith(
        'gear-1',
        'component-1',
        expect.objectContaining({
          addedAt: null
        })
      )
    })
  })

  it('updates a retired component without sending removedAt', async () => {
    const onSaved = vi.fn()
    render(
      <GearComponentFormDialog
        open={true}
        gearId="gear-1"
        component={createComponent({ removedAt: Date.UTC(2025, 5, 1) })}
        onOpenChange={vi.fn()}
        onSaved={onSaved}
      />
    )

    fireEvent.change(screen.getByLabelText('Brand'), {
      target: { value: 'Michelin' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(mockUpdateFitnessGearComponent).toHaveBeenCalledWith(
        'gear-1',
        'component-1',
        expect.not.objectContaining({ removedAt: expect.anything() })
      )
    })
    expect(onSaved).toHaveBeenCalled()
  })

  it('preserves custom componentType and unlisted service reminder distance', () => {
    render(
      <GearComponentFormDialog
        open={true}
        gearId="gear-1"
        component={createComponent({
          componentType: 'Power meter',
          serviceDistanceMeters: 2000000
        })}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />
    )

    expect(screen.getByLabelText('Component type')).toHaveValue('Power meter')
    expect(screen.getByLabelText('Service reminder')).toHaveValue('2000')
  })

  it('validates that an added date is provided when Specify date is chosen', async () => {
    render(
      <GearComponentFormDialog
        open={true}
        gearId="gear-1"
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />
    )

    fireEvent.change(screen.getByLabelText('Added on'), {
      target: { value: 'date' }
    })
    const dateInput = screen.getByLabelText('Added date')
    expect(dateInput).toBeRequired()

    fireEvent.submit(screen.getByRole('form', { name: 'Add component' }))

    expect(
      await screen.findByText('Please select an added date.')
    ).toBeInTheDocument()
    expect(mockCreateFitnessGearComponent).not.toHaveBeenCalled()
  })

  it('surfaces an error message when saving fails and does not close', async () => {
    mockUpdateFitnessGearComponent.mockRejectedValueOnce(
      new Error('removedAt must be after addedAt')
    )
    const onOpenChange = vi.fn()
    const onSaved = vi.fn()

    render(
      <GearComponentFormDialog
        open={true}
        gearId="gear-1"
        component={createComponent()}
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(
      await screen.findByText('removedAt must be after addedAt')
    ).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('closes when Cancel is clicked', () => {
    const onOpenChange = vi.fn()
    render(
      <GearComponentFormDialog
        open={true}
        gearId="gear-1"
        onOpenChange={onOpenChange}
        onSaved={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
