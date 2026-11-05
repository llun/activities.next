/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'

import { ActivityBestEfforts } from '@/app/(timeline)/[actor]/[status]/ActivityBestEfforts'

const efforts = [
  { durationSeconds: 5, watts: 812 },
  { durationSeconds: 60, watts: 455 },
  { durationSeconds: 300, watts: 320 },
  { durationSeconds: 1200, watts: 268 },
  { durationSeconds: 3600, watts: 231 }
]

describe('ActivityBestEfforts', () => {
  it('wraps the PR badge under the watts in a narrow strip cell', () => {
    const { container } = render(
      <ActivityBestEfforts efforts={efforts} recordDurations={[300]} />
    )
    const strip = container.querySelector('#best-efforts .hidden')
    expect(strip).not.toBeNull()

    const value = within(strip as HTMLElement).getByText('320 W')
    expect(value.className).toContain('flex-wrap')
    expect(value).toContainElement(within(value).getByText('PR'))
    expect(screen.getAllByText('PR')).toHaveLength(2)
  })
})
