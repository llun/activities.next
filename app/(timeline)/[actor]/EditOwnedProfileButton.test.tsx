/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react'

import { switchActor } from '@/lib/client'
import { setActiveOfflineSession } from '@/lib/client/offline'

import { EditOwnedProfileButton } from './EditOwnedProfileButton'

vi.mock('@/lib/client', () => ({ switchActor: vi.fn() }))
vi.mock('@/lib/client/offline', () => ({ setActiveOfflineSession: vi.fn() }))

describe('EditOwnedProfileButton', () => {
  const originalLocation = window.location
  const assign = vi.fn()

  beforeEach(() => {
    vi.mocked(switchActor).mockReset()
    vi.mocked(setActiveOfflineSession).mockReset()
    assign.mockReset()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, assign }
    })
  })

  afterEach(() => {
    cleanup()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation
    })
  })

  const setup = () =>
    render(<EditOwnedProfileButton actorId="actor-2" handle="@side@x.test" />)

  it('switches, sets the offline session, then loads the editor', async () => {
    const order: string[] = []
    vi.mocked(switchActor).mockImplementation(async () => {
      order.push('switch')
      return true
    })
    vi.mocked(setActiveOfflineSession).mockImplementation(async () => {
      order.push('offline')
    })
    assign.mockImplementation(() => order.push('navigate'))
    setup()

    fireEvent.click(screen.getByRole('button', { name: 'Edit profile' }))

    await waitFor(() => expect(assign).toHaveBeenCalled())
    expect(switchActor).toHaveBeenCalledWith({ actorId: 'actor-2' })
    expect(setActiveOfflineSession).toHaveBeenCalledWith({ actorId: 'actor-2' })
    expect(assign).toHaveBeenCalledWith('/settings/profile?switched=1')
    expect(order).toEqual(['switch', 'offline', 'navigate'])
  })

  it('ignores an offline session failure and still navigates', async () => {
    vi.mocked(switchActor).mockResolvedValue(true)
    vi.mocked(setActiveOfflineSession).mockRejectedValue(new Error('no db'))
    setup()

    fireEvent.click(screen.getByRole('button', { name: 'Edit profile' }))

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('/settings/profile?switched=1')
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows an Alert and stays when the switch fails', async () => {
    vi.mocked(switchActor).mockResolvedValue(false)
    setup()

    fireEvent.click(screen.getByRole('button', { name: 'Edit profile' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to switch to @side@x.test'
    )
    expect(setActiveOfflineSession).not.toHaveBeenCalled()
    expect(assign).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Edit profile' })).toBeEnabled()
  })

  it('shows the error message when the switch throws', async () => {
    vi.mocked(switchActor).mockRejectedValue(new Error('Network down'))
    setup()

    fireEvent.click(screen.getByRole('button', { name: 'Edit profile' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Network down')
    expect(assign).not.toHaveBeenCalled()
  })
})
