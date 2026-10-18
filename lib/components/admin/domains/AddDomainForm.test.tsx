/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { AdminDomain } from '@/lib/services/domains/adminDomainTypes'
import { createDeferred } from '@/lib/testing/deferred'

import { AddDomainForm } from './AddDomainForm'

const mockAdd = vi.fn()
const mockCheck = vi.fn()
const mockSetStatus = vi.fn()
const mockPush = vi.fn()

vi.mock('@/lib/client', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/client/adminDomains')
  >('@/lib/client/adminDomains')
  return {
    AdminDomainRequestError: actual.AdminDomainRequestError,
    addAdminDomain: (domain: string) => mockAdd(domain),
    checkAdminDomain: (domain: string) => mockCheck(domain),
    setAdminDomainStatus: (domain: string, status: string) =>
      mockSetStatus(domain, status)
  }
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() })
}))

const domain = (lastCheck: AdminDomain['lastCheck']): AdminDomain => ({
  domain: 'photos.example',
  source: 'database',
  name: null,
  status: 'off',
  profiles: 0,
  signupsOpen: false,
  allowedEmails: [],
  allowExistingUsers: false,
  lastCheckedAt: 1,
  lastCheck
})

const FAILED = domain({
  passed: false,
  reason: 'tls',
  items: [
    { key: 'dns', status: 'passed' },
    { key: 'tls', status: 'failed' },
    { key: 'host', status: 'skipped' }
  ]
})

const PASSED = domain({
  passed: true,
  reason: 'passed',
  items: [
    { key: 'dns', status: 'passed' },
    { key: 'tls', status: 'passed' },
    { key: 'host', status: 'passed' }
  ]
})

const typeDomain = (value: string) =>
  fireEvent.change(screen.getByLabelText('Domain'), {
    target: { value }
  })

describe('AddDomainForm', () => {
  beforeEach(() => {
    mockAdd.mockReset()
    mockCheck.mockReset()
    mockSetStatus.mockReset()
    mockPush.mockReset()
  })

  it('starts ready: the domain is added as off', () => {
    render(<AddDomainForm />)
    expect(screen.getByText('The domain is added as Off.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check domain' })).toBeDisabled()
    typeDomain('photos.example')
    expect(
      screen.getByRole('button', { name: 'Check domain' })
    ).not.toBeDisabled()
  })

  it('shows the checking state while it waits', async () => {
    let resolve: (value: AdminDomain) => void = () => undefined
    mockAdd.mockReturnValue(new Promise((done) => (resolve = done)))
    render(<AddDomainForm />)
    typeDomain('photos.example')
    fireEvent.click(screen.getByRole('button', { name: 'Check domain' }))

    expect(
      await screen.findByText('Checking photos.example')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Checking/ })).toBeDisabled()
    resolve(FAILED)
    await screen.findByText('photos.example does not reach this server yet')
  })

  it('lists what to fix when the check fails, then checks again', async () => {
    mockAdd.mockResolvedValue(FAILED)
    mockCheck.mockResolvedValue(PASSED)
    render(<AddDomainForm />)
    typeDomain('Photos.Example')
    fireEvent.click(screen.getByRole('button', { name: 'Check domain' }))

    expect(
      await screen.findByText('photos.example does not reach this server yet')
    ).toBeInTheDocument()
    expect(screen.getByText('TLS certificate')).toBeInTheDocument()
    expect(
      screen.getByText(
        'No valid certificate for photos.example. Issue one for this domain.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText('Fix the items above, then check again.')
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(
      await screen.findByText('photos.example reaches this server')
    ).toBeInTheDocument()
    expect(mockCheck).toHaveBeenCalledWith('photos.example')
    expect(mockAdd).toHaveBeenCalledTimes(1)
  })

  it('offers Turn on and the domain settings once the check passes', async () => {
    mockAdd.mockResolvedValue(PASSED)
    mockSetStatus.mockResolvedValue({ ...PASSED, status: 'on' })
    render(<AddDomainForm />)
    typeDomain('photos.example')
    fireEvent.click(screen.getByRole('button', { name: 'Check domain' }))

    await screen.findByText('photos.example reaches this server')
    expect(
      screen.getByRole('link', { name: 'Open domain settings' })
    ).toHaveAttribute('href', '/admin/domains/photos.example')

    fireEvent.click(
      screen.getByRole('button', { name: 'Turn on photos.example' })
    )
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/admin/domains/photos.example')
    )
    expect(mockSetStatus).toHaveBeenCalledWith('photos.example', 'on')
  })

  // Editing the domain mid-request would swap the footer to "Check domain"
  // and lose the passed check if turning it on then fails.
  it('locks the domain field while it turns the domain on', async () => {
    const turnOn = createDeferred<AdminDomain>()
    mockAdd.mockResolvedValue(PASSED)
    mockSetStatus.mockReturnValue(turnOn.promise)
    render(<AddDomainForm />)
    typeDomain('photos.example')
    fireEvent.click(screen.getByRole('button', { name: 'Check domain' }))
    await screen.findByText('photos.example reaches this server')

    fireEvent.click(
      screen.getByRole('button', { name: 'Turn on photos.example' })
    )
    await waitFor(() => expect(screen.getByLabelText('Domain')).toBeDisabled())

    turnOn.resolve({ ...PASSED, status: 'on' })
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/admin/domains/photos.example')
    )
  })

  it('shows why a domain cannot be added', async () => {
    const { AdminDomainRequestError } =
      await import('@/lib/client/adminDomains')
    mockAdd.mockRejectedValue(
      new AdminDomainRequestError(
        'Wildcards can only be set in ACTIVITIES_TRUSTED_HOSTS.',
        'wildcard',
        null
      )
    )
    render(<AddDomainForm />)
    typeDomain('*.photos.example')
    fireEvent.click(screen.getByRole('button', { name: 'Check domain' }))
    expect(
      await screen.findByText(
        'Wildcards can only be set in ACTIVITIES_TRUSTED_HOSTS.'
      )
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Domain')).toHaveAttribute(
      'aria-invalid',
      'true'
    )
  })

  it('checks the existing row again when the domain was added before', async () => {
    const { AdminDomainRequestError } =
      await import('@/lib/client/adminDomains')
    mockAdd.mockRejectedValue(
      new AdminDomainRequestError(
        'That domain is already in the list.',
        'exists',
        null
      )
    )
    mockCheck.mockResolvedValue(PASSED)
    render(<AddDomainForm />)
    typeDomain('photos.example')
    fireEvent.click(screen.getByRole('button', { name: 'Check domain' }))
    expect(
      await screen.findByText('photos.example reaches this server')
    ).toBeInTheDocument()
    expect(mockCheck).toHaveBeenCalledWith('photos.example')
  })
})
