/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render } from '@testing-library/react'

import { ActivityDistributionRow } from '@/app/(timeline)/[actor]/[status]/ActivityDistributionRow'
import { computeZoneTimes } from '@/app/(timeline)/[actor]/[status]/fitnessChartData'
import {
  DEFAULT_HEART_RATE_ZONES,
  getPowerZones
} from '@/lib/fitness/trainingZones'

const heartRateZones = computeZoneTimes(
  [110, 130, 150, 165, 180],
  300,
  DEFAULT_HEART_RATE_ZONES
)
const powerZones = computeZoneTimes(
  [100, 180, 220, 260, 300],
  300,
  getPowerZones({ functionalThresholdPower: 260 }) ?? []
)
const powerDistribution = {
  bins: [
    { fromWatts: 100, minutes: 2 },
    { fromWatts: 125, minutes: 3 }
  ],
  isLastOpenEnded: false
}
const powerCurve = [
  { durationSeconds: 5, watts: 400 },
  { durationSeconds: 60, watts: 300 }
]

const renderRow = (withPowerZones: boolean) =>
  render(
    <ActivityDistributionRow
      heartRateZones={heartRateZones}
      powerZones={withPowerZones ? powerZones : []}
      heartRateStats={{ avg: 140, max: 180 }}
      powerDistribution={powerDistribution}
      avgPower={210}
      maxPower={400}
      powerCurve={powerCurve}
    />
  )

describe('ActivityDistributionRow layout', () => {
  it('lays three sections three across on a wide column', () => {
    const { container } = renderRow(false)
    const grid = container.querySelector('#zones')

    expect(grid?.children).toHaveLength(3)
    expect(grid?.className).toContain('@min-[820px]:grid-cols-3')
  })

  it('pairs four sections two by two instead of leaving one alone', () => {
    const { container } = renderRow(true)
    const grid = container.querySelector('#zones')

    expect(grid?.children).toHaveLength(4)
    expect(grid?.className).not.toContain('@min-[820px]:grid-cols-3')
    expect(grid?.className).toContain('@min-[600px]:grid-cols-2')
  })
})
