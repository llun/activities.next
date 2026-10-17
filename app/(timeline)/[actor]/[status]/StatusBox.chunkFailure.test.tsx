/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import {
  pollStatusCurrentTime,
  pollStatusFixture
} from '@/lib/components/posts/__fixtures__/poll-status'
import { StatusNote, StatusType } from '@/lib/types/domain/status'

import { StatusBox } from './StatusBox'

// The App Router's `next/dynamic` (React.lazy based), which rethrows a failed
// import as a render error; vitest otherwise resolves the Pages Router one.
vi.mock('next/dynamic', async () => ({
  default: (await import('next/dist/shared/lib/app-dynamic')).default
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() })
}))

vi.mock('./FitnessStatusDetail', () => ({
  get FitnessStatusDetail(): never {
    throw new Error('Loading chunk failed')
  }
}))

describe('StatusBox when the fitness detail chunk fails to load', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows an inline message instead of throwing to the route error page', async () => {
    render(
      <StatusBox
        host="activities.local"
        mapProvider={{ type: 'osm' }}
        currentTime={pollStatusCurrentTime}
        status={
          {
            ...pollStatusFixture,
            type: StatusType.enum.Note,
            choices: undefined,
            fitness: { processingStatus: 'completed' }
          } as unknown as StatusNote
        }
        variant="detail"
      />
    )

    expect(await screen.findByText("Couldn't load")).toBeInTheDocument()
  })
})
