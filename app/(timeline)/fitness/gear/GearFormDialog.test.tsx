/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { createFitnessGear, updateFitnessGear } from '@/lib/client'
import type { GearEntity } from '@/lib/services/fitness-gears/gearEntities'

import { GearFormDialog } from './GearFormDialog'

vi.mock('@/lib/client', () => ({
  createFitnessGear: vi.fn(),
  updateFitnessGear: vi.fn()
}))

// Radix's Switch measures its thumb with ResizeObserver, which jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const mockCreateFitnessGear = createFitnessGear as jest.MockedFunction<
  typeof createFitnessGear
>
const mockUpdateFitnessGear = updateFitnessGear as jest.MockedFunction<
  typeof updateFitnessGear
>

const createGear = (overrides: Partial<GearEntity> = {}): GearEntity => ({
  id: 'gear-1',
  kind: 'bike',
  name: 'Rocket',
  brand: 'Canyon',
  model: 'Endurace',
  bikeType: 'Road bike',
  weightKilograms: 8.1,
  defaultSports: ['ride'],
  alertDistanceMeters: null,
  notes: 'Winter build',
  retiredAt: null,
  createdAt: Date.UTC(2018, 10, 27),
  distanceMeters: 0,
  activityCount: 0,
  ...overrides
})

const renderDialog = (props: Partial<Parameters<typeof GearFormDialog>[0]>) =>
  render(
    <GearFormDialog
      open
      kind="bike"
      onOpenChange={vi.fn()}
      onSaved={vi.fn()}
      {...props}
    />
  )

describe('GearFormDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    mockCreateFitnessGear.mockResolvedValue(createGear())
    mockUpdateFitnessGear.mockResolvedValue(createGear())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    {
      description: 'adds a bike',
      kind: 'bike' as const,
      gear: null,
      title: 'Add a bike'
    },
    {
      description: 'adds shoes',
      kind: 'shoes' as const,
      gear: null,
      title: 'Add shoes'
    },
    {
      description: 'edits a bike',
      kind: 'bike' as const,
      gear: createGear(),
      title: 'Edit bike'
    },
    {
      description: 'edits shoes',
      kind: 'shoes' as const,
      gear: createGear({ kind: 'shoes' }),
      title: 'Edit shoes'
    }
  ])('$description with the matching title', ({ kind, gear, title }) => {
    renderDialog({ kind, gear })
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
  })

  it.each([
    {
      description: 'labels a new bike submit',
      kind: 'bike' as const,
      gear: null,
      label: 'Save bike'
    },
    {
      description: 'labels a new shoes submit',
      kind: 'shoes' as const,
      gear: null,
      label: 'Save shoes'
    },
    {
      description: 'labels an edit submit',
      kind: 'bike' as const,
      gear: createGear(),
      label: 'Save changes'
    }
  ])('$description', ({ kind, gear, label }) => {
    renderDialog({ kind, gear })
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
  })

  it('shows the bike-only fields and the bike sports', () => {
    renderDialog({ kind: 'bike' })

    expect(screen.getByLabelText('Type')).toBeInTheDocument()
    expect(screen.getByLabelText('Weight (kg)')).toBeInTheDocument()
    expect(screen.getByLabelText('Ride')).toBeInTheDocument()
    expect(screen.getByLabelText('Virtual ride')).toBeInTheDocument()
    expect(screen.queryByLabelText('Run')).not.toBeInTheDocument()
    expect(screen.queryByText('Distance alert')).not.toBeInTheDocument()
  })

  it('shows the shoes-only fields and the shoes sports', () => {
    renderDialog({ kind: 'shoes' })

    expect(screen.queryByLabelText('Type')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Weight (kg)')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Run')).toBeInTheDocument()
    expect(screen.getByLabelText('Hike')).toBeInTheDocument()
    expect(screen.queryByLabelText('Ride')).not.toBeInTheDocument()
    expect(
      screen.getByText(
        "Most running shoes wear out between 500 and 800 km. You'll get a notification and an email when the pair passes the mark."
      )
    ).toBeInTheDocument()
  })

  it('reveals the alert distance select only when the switch is on, defaulting to 650 km', () => {
    renderDialog({ kind: 'shoes' })

    expect(screen.queryByLabelText('Alert at')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: 'Distance alert' }))

    expect(screen.getByLabelText('Alert at')).toHaveValue('650')
  })

  it('derives the name from the nickname and sends the bike fields', async () => {
    const onSaved = vi.fn()
    const onOpenChange = vi.fn()
    renderDialog({ kind: 'bike', onSaved, onOpenChange })

    fireEvent.change(screen.getByLabelText('Brand'), {
      target: { value: 'Canyon' }
    })
    fireEvent.change(screen.getByLabelText('Model'), {
      target: { value: 'Endurace' }
    })
    fireEvent.change(screen.getByLabelText('Nickname'), {
      target: { value: 'Rocket' }
    })
    fireEvent.change(screen.getByLabelText('Type'), {
      target: { value: 'Gravel bike' }
    })
    fireEvent.change(screen.getByLabelText('Weight (kg)'), {
      target: { value: '8.1' }
    })
    fireEvent.click(screen.getByLabelText('Gravel ride'))
    fireEvent.click(screen.getByRole('button', { name: 'Save bike' }))

    await waitFor(() => expect(mockCreateFitnessGear).toHaveBeenCalledTimes(1))
    expect(mockCreateFitnessGear).toHaveBeenCalledWith({
      kind: 'bike',
      name: 'Rocket',
      brand: 'Canyon',
      model: 'Endurace',
      bikeType: 'Gravel bike',
      weightKilograms: 8.1,
      defaultSports: ['gravel_ride'],
      // A bike may never carry an alert distance — the API 422s on it.
      alertDistanceMeters: null,
      notes: null
    })
    expect(onSaved).toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('falls back to brand and model when there is no nickname', async () => {
    renderDialog({ kind: 'bike' })

    fireEvent.change(screen.getByLabelText('Brand'), {
      target: { value: 'Canyon' }
    })
    fireEvent.change(screen.getByLabelText('Model'), {
      target: { value: 'Endurace' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save bike' }))

    await waitFor(() => expect(mockCreateFitnessGear).toHaveBeenCalledTimes(1))
    expect(mockCreateFitnessGear.mock.calls[0][0].name).toEqual(
      'Canyon Endurace'
    )
  })

  it.each([
    {
      description: 'falls back to a bike placeholder name',
      kind: 'bike' as const,
      label: 'Save bike',
      expected: 'New bike'
    },
    {
      description: 'falls back to a shoes placeholder name',
      kind: 'shoes' as const,
      label: 'Save shoes',
      expected: 'New shoes'
    }
  ])('$description', async ({ kind, label, expected }) => {
    renderDialog({ kind })

    fireEvent.click(screen.getByRole('button', { name: label }))

    await waitFor(() => expect(mockCreateFitnessGear).toHaveBeenCalledTimes(1))
    expect(mockCreateFitnessGear.mock.calls[0][0].name).toEqual(expected)
  })

  it('converts the shoes alert from kilometres to meters and clears the bike fields', async () => {
    renderDialog({ kind: 'shoes' })

    fireEvent.change(screen.getByLabelText('Nickname'), {
      target: { value: 'Daily trainers' }
    })
    fireEvent.click(screen.getByRole('switch', { name: 'Distance alert' }))
    fireEvent.change(screen.getByLabelText('Alert at'), {
      target: { value: '800' }
    })
    fireEvent.click(screen.getByLabelText('Trail run'))
    fireEvent.click(screen.getByRole('button', { name: 'Save shoes' }))

    await waitFor(() => expect(mockCreateFitnessGear).toHaveBeenCalledTimes(1))
    expect(mockCreateFitnessGear).toHaveBeenCalledWith({
      kind: 'shoes',
      name: 'Daily trainers',
      brand: null,
      model: null,
      // Shoes may never carry a frame type or a weight.
      bikeType: null,
      weightKilograms: null,
      defaultSports: ['trail_run'],
      alertDistanceMeters: 800000,
      notes: null
    })
  })

  it('seeds the fields from the gear being edited and updates it', async () => {
    const gear = createGear({ name: 'Rocket' })
    renderDialog({ kind: 'bike', gear })

    expect(screen.getByLabelText('Brand')).toHaveValue('Canyon')
    expect(screen.getByLabelText('Model')).toHaveValue('Endurace')
    expect(screen.getByLabelText('Nickname')).toHaveValue('Rocket')
    expect(screen.getByLabelText('Type')).toHaveValue('Road bike')
    expect(screen.getByLabelText('Weight (kg)')).toHaveValue(8.1)
    expect(screen.getByLabelText('Notes')).toHaveValue('Winter build')
    expect(screen.getByLabelText('Ride')).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(mockUpdateFitnessGear).toHaveBeenCalledTimes(1))
    expect(mockUpdateFitnessGear.mock.calls[0][0]).toEqual('gear-1')
    expect(mockUpdateFitnessGear.mock.calls[0][1].name).toEqual('Rocket')
    expect(mockCreateFitnessGear).not.toHaveBeenCalled()
  })

  it('leaves the nickname blank when the stored name is only brand and model', () => {
    renderDialog({
      kind: 'bike',
      gear: createGear({ name: 'Canyon Endurace' })
    })

    expect(screen.getByLabelText('Nickname')).toHaveValue('')
  })

  it('seeds the alert switch from an existing shoes alert distance', () => {
    renderDialog({
      kind: 'shoes',
      gear: createGear({
        kind: 'shoes',
        bikeType: null,
        weightKilograms: null,
        defaultSports: ['run'],
        alertDistanceMeters: 700000
      })
    })

    expect(screen.getByRole('switch', { name: 'Distance alert' })).toBeChecked()
    expect(screen.getByLabelText('Alert at')).toHaveValue('700')
  })

  it('surfaces a save failure and keeps the dialog open', async () => {
    const onOpenChange = vi.fn()
    mockCreateFitnessGear.mockRejectedValue(new Error('Gear name is required'))
    renderDialog({ kind: 'bike', onOpenChange })

    fireEvent.click(screen.getByRole('button', { name: 'Save bike' }))

    await waitFor(() =>
      expect(screen.getByText('Gear name is required')).toBeInTheDocument()
    )
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
