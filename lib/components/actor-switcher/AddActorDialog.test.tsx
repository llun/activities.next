/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import {
  type ActorDomainsResult,
  createActor,
  getActorDomains,
  switchActor
} from '@/lib/client'
import { createDeferred } from '@/lib/testing/deferred'

import { AddActorDialog } from './AddActorDialog'

vi.mock('@/lib/client', () => ({
  getActorDomains: vi.fn(),
  createActor: vi.fn(),
  switchActor: vi.fn()
}))

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('AddActorDialog', () => {
  const defaultDomain = 'activities.local'
  const mockOnOpenChange = vi.fn()
  const mockOnSuccess = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    vi.mocked(getActorDomains).mockReset()
    vi.mocked(createActor).mockReset()
    vi.mocked(switchActor).mockReset()
    mockOnOpenChange.mockReset()
    mockOnSuccess.mockReset()

    vi.mocked(getActorDomains).mockResolvedValue({
      domains: [defaultDomain],
      host: defaultDomain
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const renderDialog = (
    props: Partial<Parameters<typeof AddActorDialog>[0]> = {}
  ) =>
    render(
      <AddActorDialog
        open
        onOpenChange={mockOnOpenChange}
        domain={defaultDomain}
        onSuccess={mockOnSuccess}
        {...props}
      />
    )

  describe('domain loading and selection', () => {
    it('fetches allowed domains with an abort signal on open', async () => {
      renderDialog()

      expect(getActorDomains).toHaveBeenCalledWith({
        signal: expect.any(AbortSignal)
      })
    })

    it('renders radio group when multiple domains are available and selects host by default', async () => {
      vi.mocked(getActorDomains).mockResolvedValue({
        domains: ['alias.example', defaultDomain],
        host: defaultDomain
      })

      renderDialog()

      await waitFor(() => {
        expect(screen.getByText('Domain')).toBeInTheDocument()
      })

      expect(
        screen.getByLabelText(new RegExp(`${defaultDomain}.*\\(main\\)`))
      ).toBeChecked()
      expect(screen.getByLabelText('alias.example')).not.toBeChecked()
      expect(
        screen.getByText(`Your new handle will be @username@${defaultDomain}`)
      ).toBeInTheDocument()
    })

    it('selects first domain when host domain is not in the allowed list', async () => {
      vi.mocked(getActorDomains).mockResolvedValue({
        domains: ['first.example', 'second.example'],
        host: 'unlisted.example'
      })

      renderDialog()

      await waitFor(() => {
        expect(screen.getByLabelText('first.example')).toBeChecked()
      })
      expect(
        screen.getByText('Your new handle will be @username@first.example')
      ).toBeInTheDocument()
    })

    it('updates handle preview when user selects a different domain', async () => {
      vi.mocked(getActorDomains).mockResolvedValue({
        domains: [defaultDomain, 'secondary.example'],
        host: defaultDomain
      })

      renderDialog()

      await waitFor(() => {
        expect(screen.getByText('secondary.example')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByLabelText('secondary.example'))

      expect(screen.getByLabelText('secondary.example')).toBeChecked()
      expect(
        screen.getByText('Your new handle will be @username@secondary.example')
      ).toBeInTheDocument()
    })

    it('does not re-fetch domains if domains have already loaded', async () => {
      const { rerender } = renderDialog({ open: true })

      await waitFor(() => {
        expect(getActorDomains).toHaveBeenCalledTimes(1)
      })

      rerender(
        <AddActorDialog
          open={false}
          onOpenChange={mockOnOpenChange}
          domain={defaultDomain}
          onSuccess={mockOnSuccess}
        />
      )

      rerender(
        <AddActorDialog
          open={true}
          onOpenChange={mockOnOpenChange}
          domain={defaultDomain}
          onSuccess={mockOnSuccess}
        />
      )

      expect(getActorDomains).toHaveBeenCalledTimes(1)
    })
  })

  describe('stale responses and cancellation', () => {
    it('aborts in-flight domain request when dialog is closed', async () => {
      const deferred = createDeferred<ActorDomainsResult>()
      let capturedSignal: AbortSignal | undefined

      vi.mocked(getActorDomains).mockImplementation((params) => {
        capturedSignal = params?.signal
        return deferred.promise
      })

      const { rerender } = renderDialog({ open: true })

      expect(capturedSignal).toBeDefined()
      expect(capturedSignal?.aborted).toBe(false)

      rerender(
        <AddActorDialog
          open={false}
          onOpenChange={mockOnOpenChange}
          domain={defaultDomain}
          onSuccess={mockOnSuccess}
        />
      )

      expect(capturedSignal?.aborted).toBe(true)

      // Settling the promise after close should not update state or throw
      await act(async () => {
        deferred.resolve({
          domains: ['late.example', defaultDomain],
          host: defaultDomain
        })
      })

      expect(screen.queryByText('late.example')).not.toBeInTheDocument()
    })

    it('aborts in-flight domain request when dialog unmounts', async () => {
      const deferred = createDeferred<ActorDomainsResult>()
      let capturedSignal: AbortSignal | undefined

      vi.mocked(getActorDomains).mockImplementation((params) => {
        capturedSignal = params?.signal
        return deferred.promise
      })

      const { unmount } = renderDialog({ open: true })

      expect(capturedSignal?.aborted).toBe(false)

      unmount()

      expect(capturedSignal?.aborted).toBe(true)

      await act(async () => {
        deferred.resolve({
          domains: ['unmounted.example'],
          host: defaultDomain
        })
      })
    })

    it('does not expose error when aborted by dialog closure', async () => {
      const deferred = createDeferred<ActorDomainsResult>()

      vi.mocked(getActorDomains).mockReturnValue(deferred.promise)

      const { rerender } = renderDialog({ open: true })

      rerender(
        <AddActorDialog
          open={false}
          onOpenChange={mockOnOpenChange}
          domain={defaultDomain}
          onSuccess={mockOnSuccess}
        />
      )

      await act(async () => {
        deferred.reject(
          new DOMException('The user aborted a request.', 'AbortError')
        )
      })

      expect(screen.queryByText(/aborted/i)).not.toBeInTheDocument()
    })
  })

  describe('domain loading failures', () => {
    it('exposes API domain loading failure through existing error UI', async () => {
      vi.mocked(getActorDomains).mockRejectedValue(
        new Error('Failed to fetch actor domains')
      )

      renderDialog()

      await waitFor(() => {
        expect(
          screen.getByText('Failed to fetch actor domains')
        ).toBeInTheDocument()
      })
    })

    it('exposes network domain loading failure through existing error UI', async () => {
      vi.mocked(getActorDomains).mockRejectedValue(new Error('Network error'))

      renderDialog()

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument()
      })
    })
  })

  describe('client-side validation', () => {
    it('shows error when username is empty or whitespace', async () => {
      renderDialog()

      const submitButton = screen.getByRole('button', { name: 'Create actor' })
      const input = screen.getByLabelText('Username')

      expect(submitButton).toBeDisabled()

      fireEvent.change(input, { target: { value: '   ' } })
      expect(submitButton).toBeDisabled()

      fireEvent.submit(input.closest('form')!)

      expect(screen.getByText('Username is required')).toBeInTheDocument()
      expect(createActor).not.toHaveBeenCalled()
    })

    it('shows error when username contains invalid characters', async () => {
      renderDialog()

      const input = screen.getByLabelText('Username')

      fireEvent.change(input, { target: { value: 'invalid user!' } })
      fireEvent.submit(input.closest('form')!)

      expect(
        screen.getByText(
          'Username can only contain letters, numbers, and underscores'
        )
      ).toBeInTheDocument()
      expect(createActor).not.toHaveBeenCalled()
    })
  })

  describe('actor creation and switching', () => {
    it('creates actor with trimmed username and selected domain, then switches', async () => {
      vi.mocked(getActorDomains).mockResolvedValue({
        domains: [defaultDomain, 'custom.domain'],
        host: defaultDomain
      })
      vi.mocked(createActor).mockResolvedValue({
        id: 'new-actor-id',
        username: 'carol',
        domain: 'custom.domain'
      })
      vi.mocked(switchActor).mockResolvedValue(true)

      renderDialog()

      await waitFor(() => {
        expect(screen.getByText('custom.domain')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByLabelText('custom.domain'))

      const input = screen.getByLabelText('Username')
      fireEvent.change(input, { target: { value: 'carol' } })

      fireEvent.submit(input.closest('form')!)

      await waitFor(() => {
        expect(createActor).toHaveBeenCalledWith({
          username: 'carol',
          domain: 'custom.domain'
        })
      })

      expect(switchActor).toHaveBeenCalledWith({ actorId: 'new-actor-id' })
      expect(mockOnSuccess).toHaveBeenCalled()
      expect(input).toHaveValue('')
    })

    it('shows creating state while creation request is in flight', async () => {
      const deferred = createDeferred<{
        id: string
        username: string
        domain: string
      }>()
      vi.mocked(createActor).mockReturnValue(deferred.promise)

      renderDialog()

      const input = screen.getByLabelText('Username')
      fireEvent.change(input, { target: { value: 'dan' } })

      fireEvent.submit(input.closest('form')!)

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: 'Creating...' })
        ).toBeDisabled()
      })
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()

      await act(async () => {
        deferred.resolve({
          id: 'dan-id',
          username: 'dan',
          domain: defaultDomain
        })
      })

      await waitFor(() => {
        expect(switchActor).toHaveBeenCalledWith({ actorId: 'dan-id' })
      })
    })

    it('exposes API error when creation fails', async () => {
      vi.mocked(createActor).mockRejectedValue(
        new Error('Username already exists')
      )

      renderDialog()

      const input = screen.getByLabelText('Username')
      fireEvent.change(input, { target: { value: 'existing_user' } })

      fireEvent.submit(input.closest('form')!)

      await waitFor(() => {
        expect(screen.getByText('Username already exists')).toBeInTheDocument()
      })

      expect(switchActor).not.toHaveBeenCalled()
      expect(mockOnSuccess).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Create actor' })).toBeEnabled()
    })

    it('exposes network failure when creation encounters an error', async () => {
      vi.mocked(createActor).mockRejectedValue(
        new Error('Network disconnected')
      )

      renderDialog()

      const input = screen.getByLabelText('Username')
      fireEvent.change(input, { target: { value: 'testuser' } })

      fireEvent.submit(input.closest('form')!)

      await waitFor(() => {
        expect(screen.getByText('Network disconnected')).toBeInTheDocument()
      })

      expect(switchActor).not.toHaveBeenCalled()
      expect(mockOnSuccess).not.toHaveBeenCalled()
    })
  })

  describe('dialog cancellation and close behavior', () => {
    it('notifies parent on cancel button click', () => {
      renderDialog()

      const cancelButton = screen.getByRole('button', { name: 'Cancel' })
      fireEvent.click(cancelButton)

      expect(mockOnOpenChange).toHaveBeenCalledWith(false)
    })

    it('resets username and error state when dialog is closed', async () => {
      vi.mocked(createActor).mockRejectedValue(new Error('Failed'))

      const { rerender } = renderDialog({ open: true })

      const input = screen.getByLabelText('Username')
      fireEvent.change(input, { target: { value: 'someuser' } })

      fireEvent.submit(input.closest('form')!)

      await waitFor(() => {
        expect(screen.getByText('Failed')).toBeInTheDocument()
      })

      rerender(
        <AddActorDialog
          open={false}
          onOpenChange={mockOnOpenChange}
          domain={defaultDomain}
          onSuccess={mockOnSuccess}
        />
      )

      rerender(
        <AddActorDialog
          open={true}
          onOpenChange={mockOnOpenChange}
          domain={defaultDomain}
          onSuccess={mockOnSuccess}
        />
      )

      expect(screen.queryByText('Failed')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Username')).toHaveValue('')
    })
  })
})
