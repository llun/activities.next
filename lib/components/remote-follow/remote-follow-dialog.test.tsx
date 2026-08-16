/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { getRemoteFollowUrl } from '@/lib/client'

import { RemoteFollowDialog } from './remote-follow-dialog'

vi.mock('@/lib/client', () => ({
  getRemoteFollowUrl: vi.fn()
}))

const assign = vi.fn()

beforeAll(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign }
  })
})

const openDialog = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Follow' }))

const typeAddress = async (value: string) => {
  const input = await screen.findByLabelText('Your address')
  fireEvent.change(input, { target: { value } })
  return input
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Go' }))

describe('RemoteFollowDialog', () => {
  const getRemoteFollowUrlMock = getRemoteFollowUrl as jest.Mock

  beforeEach(() => {
    getRemoteFollowUrlMock.mockReset()
    assign.mockReset()
    window.localStorage.clear()
    getRemoteFollowUrlMock.mockResolvedValue(
      'https://remote.test/authorize_interaction?uri=local%40llun.test'
    )
  })

  it('sends the visitor to the url the server resolves', async () => {
    render(<RemoteFollowDialog targetHandle="local@llun.test" />)
    openDialog()

    await typeAddress('visitor@remote.test')
    submit()

    await waitFor(() => {
      expect(getRemoteFollowUrlMock).toHaveBeenCalledWith({
        account: 'visitor@remote.test',
        target: 'local@llun.test'
      })
    })
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith(
        'https://remote.test/authorize_interaction?uri=local%40llun.test'
      )
    })
  })

  it('trims the typed address before sending it', async () => {
    render(<RemoteFollowDialog targetHandle="local@llun.test" />)
    openDialog()

    await typeAddress('  visitor@remote.test  ')
    submit()

    await waitFor(() => {
      expect(getRemoteFollowUrlMock).toHaveBeenCalledWith({
        account: 'visitor@remote.test',
        target: 'local@llun.test'
      })
    })
  })

  it('shows the failure message and stays put when the lookup fails', async () => {
    getRemoteFollowUrlMock.mockRejectedValue(
      new Error('Unable to reach that server')
    )
    render(<RemoteFollowDialog targetHandle="local@llun.test" />)
    openDialog()

    await typeAddress('visitor@remote.test')
    submit()

    expect(
      await screen.findByText('Unable to reach that server')
    ).toBeInTheDocument()
    expect(assign).not.toHaveBeenCalled()
  })

  it('rejects an address containing whitespace without calling the server', async () => {
    render(<RemoteFollowDialog targetHandle="local@llun.test" />)
    openDialog()

    await typeAddress('visitor name@remote.test')
    submit()

    expect(
      await screen.findByText(
        'Enter your address, for example username@mastodon.social'
      )
    ).toBeInTheDocument()
    expect(getRemoteFollowUrlMock).not.toHaveBeenCalled()
  })

  it('remembers the address for the next visit', async () => {
    render(<RemoteFollowDialog targetHandle="local@llun.test" />)
    openDialog()

    await typeAddress('visitor@remote.test')
    submit()

    await waitFor(() => {
      expect(
        window.localStorage.getItem('activities.remote-follow-account')
      ).toEqual('visitor@remote.test')
    })
  })

  it('prefills a remembered address', async () => {
    window.localStorage.setItem(
      'activities.remote-follow-account',
      'visitor@remote.test'
    )
    render(<RemoteFollowDialog targetHandle="local@llun.test" />)
    openDialog()

    expect(await screen.findByLabelText('Your address')).toHaveValue(
      'visitor@remote.test'
    )
  })
})
