/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'

import { updateFitnessGeneralSettings } from '@/lib/client'

import { FitnessTrainingZonesSettings } from './FitnessTrainingZonesSettings'

vi.mock('@/lib/client', () => ({
  updateFitnessGeneralSettings: vi.fn()
}))

const mockUpdate = vi.mocked(updateFitnessGeneralSettings)

const previewRanges = (name: string) =>
  within(screen.getByRole('list', { name }))
    .getAllByRole('listitem')
    .map((item) => item.textContent)

const type = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

const saveButton = () => screen.getByRole('button', { name: 'Save zones' })

describe('FitnessTrainingZonesSettings', () => {
  beforeEach(() => {
    mockUpdate.mockReset()
  })

  it('previews the default zones until a max heart rate is set', () => {
    render(<FitnessTrainingZonesSettings initialZones={null} />)

    expect(
      screen.getByText(
        'Used for the zone charts on your activities. Until you set them, activities use default zones.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('Default zones')).toBeInTheDocument()
    expect(previewRanges('Heart rate zones preview')).toEqual([
      'Z1Recovery< 122 bpm',
      'Z2Endurance122–142 bpm',
      'Z3Tempo142–158 bpm',
      'Z4Threshold158–172 bpm',
      'Z5Anaerobic172+ bpm'
    ])
    expect(
      screen.queryByRole('list', { name: 'Power zones preview' })
    ).not.toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled()
  })

  it('updates the previews as the numbers are typed', () => {
    render(<FitnessTrainingZonesSettings initialZones={null} />)

    type(/^Max heart rate/, '186')
    expect(screen.queryByText('Default zones')).not.toBeInTheDocument()
    expect(previewRanges('Heart rate zones preview')).toEqual([
      'Z1Recovery< 123 bpm',
      'Z2Endurance123–141 bpm',
      'Z3Tempo141–158 bpm',
      'Z4Threshold158–171 bpm',
      'Z5Anaerobic171+ bpm'
    ])

    type(/^Resting heart rate/, '50')
    expect(previewRanges('Heart rate zones preview')[1]).toBe(
      'Z2Endurance132–145 bpm'
    )

    type(/^Functional threshold power/, '260')
    expect(previewRanges('Power zones preview')).toEqual([
      'Z1Active recovery< 143 W',
      'Z2Endurance143–195 W',
      'Z3Tempo195–234 W',
      'Z4Threshold234–273 W',
      'Z5VO2 max273–312 W',
      'Z6Anaerobic312+ W'
    ])
  })

  it('saves the zones and shows it saved', async () => {
    mockUpdate.mockResolvedValue({
      ok: true,
      data: {
        success: true,
        privacyLocations: [],
        maxHeartRate: 186,
        restingHeartRate: null,
        functionalThresholdPower: 260
      }
    })
    render(<FitnessTrainingZonesSettings initialZones={null} />)

    type(/^Max heart rate/, '186')
    type(/^Functional threshold power/, '260')
    fireEvent.click(saveButton())

    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(mockUpdate).toHaveBeenCalledWith({
      maxHeartRate: 186,
      restingHeartRate: null,
      functionalThresholdPower: 260
    })
    expect(saveButton()).toBeDisabled()
  })

  it('clears the zones when the fields are emptied and saved', async () => {
    mockUpdate.mockResolvedValue({
      ok: true,
      data: {
        success: true,
        privacyLocations: [],
        maxHeartRate: null,
        restingHeartRate: null,
        functionalThresholdPower: null
      }
    })
    render(
      <FitnessTrainingZonesSettings
        initialZones={{
          maxHeartRate: 186,
          restingHeartRate: 50,
          functionalThresholdPower: 260
        }}
      />
    )

    type(/^Max heart rate/, '')
    type(/^Resting heart rate/, '')
    type(/^Functional threshold power/, '')
    expect(screen.getByText('Default zones')).toBeInTheDocument()
    fireEvent.click(saveButton())

    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(mockUpdate).toHaveBeenCalledWith({
      maxHeartRate: null,
      restingHeartRate: null,
      functionalThresholdPower: null
    })
  })

  it('shows the server error and keeps the edits', async () => {
    mockUpdate.mockResolvedValue({
      ok: false,
      data: { error: 'Resting heart rate must be below max heart rate' }
    })
    render(<FitnessTrainingZonesSettings initialZones={null} />)

    type(/^Max heart rate/, '186')
    fireEvent.click(saveButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Resting heart rate must be below max heart rate'
    )
    expect(screen.getByLabelText(/^Max heart rate/)).toHaveValue(186)
  })

  it('refuses to save a value out of range', () => {
    render(<FitnessTrainingZonesSettings initialZones={null} />)

    type(/^Max heart rate/, '260')
    expect(
      screen.getByText(/Max heart rate must be 100–240 bpm/)
    ).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()

    type(/^Max heart rate/, '110')
    type(/^Resting heart rate/, '110')
    expect(
      screen.getByText(/Resting heart rate must be below max heart rate/)
    ).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
  })

  it('resets to the saved values', () => {
    render(
      <FitnessTrainingZonesSettings
        initialZones={{
          maxHeartRate: 186,
          restingHeartRate: null,
          functionalThresholdPower: null
        }}
      />
    )

    type(/^Max heart rate/, '200')
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))

    expect(screen.getByLabelText(/^Max heart rate/)).toHaveValue(186)
    expect(saveButton()).toBeDisabled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
