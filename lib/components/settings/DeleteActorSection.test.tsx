/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { DeleteActorSection } from './DeleteActorSection'

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ refresh: vi.fn() }))
}))

vi.mock('@/lib/client', () => ({
  deleteActor: vi.fn()
}))

const renderSection = (
  props: Partial<Parameters<typeof DeleteActorSection>[0]> = {}
) =>
  render(
    <DeleteActorSection
      actorId="actor-2"
      actorUsername="bob"
      actorDomain="llun.test"
      isDefaultActor={false}
      isOnlyActor={false}
      deletionStatus={null}
      {...props}
    />
  )

describe('DeleteActorSection', () => {
  it('offers Delete actor, which opens the confirmation dialog', async () => {
    renderSection()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete actor' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('@bob@llun.test')
  })

  it('is a standing row on the page, not an announced alert', () => {
    renderSection()

    expect(screen.getByText('Delete this actor')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each([
    [
      'the default actor',
      { isDefaultActor: true },
      'This is your default actor and cannot be deleted. Set another actor as default first.'
    ],
    [
      'the only actor',
      { isOnlyActor: true },
      'This is your only actor and cannot be deleted.'
    ]
  ])(
    'says why %s cannot be deleted, without a button',
    (_name, props, copy) => {
      renderSection(props)

      expect(screen.getByText(copy)).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Delete actor' })
      ).not.toBeInTheDocument()
    }
  )

  it.each([
    ['deleting', 'This actor is currently being deleted…'],
    ['scheduled', 'This actor is scheduled for deletion.']
  ])('shows the %s state without offering the button', (status, copy) => {
    renderSection({ deletionStatus: status })

    expect(screen.getByText('Deletion in progress')).toBeInTheDocument()
    expect(screen.getByText(copy)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Delete actor' })
    ).not.toBeInTheDocument()
  })

  it('keeps the default-actor rule ahead of an in-progress deletion', () => {
    renderSection({ isDefaultActor: true, deletionStatus: 'scheduled' })

    expect(
      screen.getByText(/default actor and cannot be deleted/)
    ).toBeVisible()
    expect(screen.queryByText('Deletion in progress')).not.toBeInTheDocument()
  })
})
