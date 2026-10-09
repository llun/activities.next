/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'

import {
  addGalleryAlbumItems,
  getMediaAlbums,
  removeGalleryAlbumItems
} from '@/lib/client'
import { buildAlbumCard } from '@/lib/components/gallery/__fixtures__/galleryAlbums'
import type { MediaAlbumsResponse } from '@/lib/services/gallery/galleryAlbumEntities'

import { MediaAlbumsControl } from './MediaAlbumsControl'
import { NOT_ADDABLE_HINT } from './mediaAlbumsUi'

vi.mock('@/lib/client', () => ({
  addGalleryAlbumItems: vi.fn(),
  getMediaAlbums: vi.fn(),
  removeGalleryAlbumItems: vi.fn()
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    prefetch: _prefetch,
    ...rest
  }: {
    href: string
    children: React.ReactNode
    prefetch?: boolean
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}))

const formDialogProps = vi.hoisted(() => ({
  current: null as null | {
    open: boolean
    initialMediaIds?: string[]
    onOpenChange: (open: boolean) => void
    onSaved: (albumId: string) => void
  }
}))

vi.mock('@/app/(timeline)/gallery/albums/GalleryAlbumFormDialog', () => ({
  GalleryAlbumFormDialog: (props: {
    open: boolean
    initialMediaIds?: string[]
    onOpenChange: (open: boolean) => void
    onSaved: (albumId: string) => void
  }) => {
    formDialogProps.current = props
    return props.open ? <div role="dialog" aria-label="New album" /> : null
  }
}))

const getMediaAlbumsMock = vi.mocked(getMediaAlbums)
const addMock = vi.mocked(addGalleryAlbumItems)
const removeMock = vi.mocked(removeGalleryAlbumItems)

const response = (
  overrides: Partial<MediaAlbumsResponse> = {}
): MediaAlbumsResponse => ({
  albums: [
    { id: 'a1', title: 'Kruger', visibility: 'public', itemCount: 14 },
    { id: 'a2', title: 'Garden birds', visibility: 'private', itemCount: 3 },
    { id: 'a3', title: 'Kruger', visibility: 'public', itemCount: 14 }
  ],
  albumIds: ['a1'],
  addable: true,
  ...overrides
})

const result = (itemCount: number, overrides = {}) => ({
  added: [],
  removed: [],
  existing: [],
  skipped: [],
  album: buildAlbumCard('a2', { itemCount }),
  ...overrides
})

const renderControl = (
  variant: 'row' | 'pill' = 'row',
  props: Partial<React.ComponentProps<typeof MediaAlbumsControl>> = {}
) =>
  render(
    <MediaAlbumsControl
      mediaId="m1"
      ownerId="owner"
      variant={variant}
      {...props}
    />
  )

const openMenu = async (name: string | RegExp = 'Add to album') => {
  fireEvent.click(await screen.findByRole('button', { name }))
  return screen.findByRole('dialog', { name: 'Add to album' })
}

describe('MediaAlbumsControl', () => {
  beforeEach(() => {
    getMediaAlbumsMock.mockReset()
    addMock.mockReset()
    removeMock.mockReset()
    formDialogProps.current = null
    getMediaAlbumsMock.mockResolvedValue(response())
  })

  describe('row', () => {
    it('lists the albums that hold the photo as chips that open in a new tab', async () => {
      renderControl()

      expect(screen.getByRole('status')).toHaveTextContent('Loading albums')
      const chips = await screen.findByRole('list', {
        name: 'Albums holding this photo'
      })
      const link = within(chips).getByRole('link', { name: /Kruger/ })
      expect(link).toHaveAttribute('href', '/gallery/albums/a1')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAccessibleName(/^Kruger\s*\(opens in a new tab\)$/)
      expect(getMediaAlbumsMock).toHaveBeenCalledWith('m1')
    })

    it('says so when the photo is in no album', async () => {
      getMediaAlbumsMock.mockResolvedValue(response({ albumIds: [] }))
      renderControl()

      expect(await screen.findByText('Not in any album yet.')).toBeVisible()
      expect(screen.queryByRole('list')).not.toBeInTheDocument()
    })

    it('tells the owner that albums are saved right away, apart from Save details', async () => {
      renderControl()

      expect(
        await screen.findByText(/Albums apply right away\./)
      ).toHaveTextContent('They are not part of Save details.')
    })

    it('draws nothing, not even its frame, for a photo that is not the caller’s', async () => {
      getMediaAlbumsMock.mockResolvedValue(null)
      const frame = vi.fn((content: React.ReactNode) => (
        <section>{content}</section>
      ))
      const { container } = renderControl('row', { renderFrame: frame })

      await waitFor(() => expect(getMediaAlbumsMock).toHaveBeenCalled())
      await act(async () => {})
      expect(container).toBeEmptyDOMElement()
    })

    it('puts the row in the frame the host gives it', async () => {
      renderControl('row', {
        renderFrame: (content) => (
          <section aria-label="Albums section">{content}</section>
        )
      })

      const section = await screen.findByRole('region', {
        name: 'Albums section'
      })
      expect(
        within(section).getByRole('button', { name: 'Add to album' })
      ).toBeVisible()
    })

    it('reports a failed load and tries again', async () => {
      getMediaAlbumsMock.mockRejectedValueOnce(new Error('Server is down'))
      renderControl()

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Server is down'
      )
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

      expect(
        await screen.findByRole('button', { name: 'Add to album' })
      ).toBeVisible()
      expect(getMediaAlbumsMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('menu', () => {
    it('gives every album its own checkbox name, even for albums that share a title', async () => {
      renderControl()
      const menu = await openMenu()

      const boxes = within(menu).getAllByRole('checkbox')
      expect(boxes.map((box) => box.getAttribute('aria-label'))).toEqual([
        'Kruger, public album, 14 photos, number 1',
        'Garden birds, private album, 3 photos',
        'Kruger, public album, 14 photos, number 2'
      ])
      expect(boxes.map((box) => (box as HTMLInputElement).checked)).toEqual([
        true,
        false,
        false
      ])
    })

    it('moves focus between the checkboxes with the arrow keys', async () => {
      renderControl()
      const menu = await openMenu()
      const [first, second] = within(menu).getAllByRole('checkbox')

      first.focus()
      fireEvent.keyDown(first, { key: 'ArrowDown' })
      expect(second).toHaveFocus()
      fireEvent.keyDown(second, { key: 'ArrowUp' })
      expect(first).toHaveFocus()
      fireEvent.keyDown(first, { key: 'ArrowUp' })
      expect(first).toHaveFocus()
    })

    it('closes on Escape and gives focus back to its button', async () => {
      renderControl()
      const button = await screen.findByRole('button', { name: 'Add to album' })
      const menu = await openMenu()

      fireEvent.keyDown(menu, { key: 'Escape' })

      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: 'Add to album' })
        ).not.toBeInTheDocument()
      )
      expect(button).toHaveFocus()
    })

    it('says so when the owner has no albums yet', async () => {
      getMediaAlbumsMock.mockResolvedValue(
        response({ albums: [], albumIds: [] })
      )
      renderControl()
      const menu = await openMenu()

      expect(menu).toHaveTextContent('You have no albums yet.')
      expect(within(menu).queryByRole('checkbox')).not.toBeInTheDocument()
      expect(
        within(menu).getByRole('button', { name: 'New album with this photo' })
      ).toBeEnabled()
    })
  })

  describe('adding and removing', () => {
    it('adds at once, announces it, and offers Undo', async () => {
      let finish: (value: ReturnType<typeof result>) => void = () => {}
      addMock.mockReturnValue(new Promise((resolve) => (finish = resolve)))
      renderControl()
      const menu = await openMenu()
      const box = within(menu).getByRole('checkbox', {
        name: /^Garden birds/
      })

      fireEvent.click(box)

      // Shown as added before the server has answered.
      expect(box).toBeChecked()
      expect(box).toHaveAttribute('aria-busy', 'true')
      expect(addMock).toHaveBeenCalledWith('a2', ['m1'])

      await act(async () => finish(result(4)))

      expect(box).not.toHaveAttribute('aria-busy')
      const toast = screen.getByTestId('album-toast')
      expect(toast).toHaveTextContent('Added to “Garden birds”')
      // The visible toast is not a live region: a second one would read twice.
      expect(toast).not.toHaveAttribute('aria-live')
      expect(screen.getAllByRole('status')[0]).toHaveTextContent(
        'Added to “Garden birds”'
      )
      // The count in the menu follows the server's answer.
      expect(
        within(menu).getByText('4', { selector: 'span' })
      ).toBeInTheDocument()
    })

    it('removes at once and offers Undo', async () => {
      removeMock.mockResolvedValue(result(13))
      renderControl()
      const menu = await openMenu()
      const box = within(menu).getAllByRole('checkbox')[0]

      fireEvent.click(box)
      expect(box).not.toBeChecked()
      await waitFor(() =>
        expect(screen.getByTestId('album-toast')).toHaveTextContent(
          'Removed from “Kruger”'
        )
      )

      expect(removeMock).toHaveBeenCalledWith('a1', ['m1'])
      expect(
        within(screen.getByTestId('album-toast')).getByRole('button', {
          name: 'Undo'
        })
      ).toBeVisible()
    })

    it('Undo puts the photo back and offers nothing further', async () => {
      addMock.mockResolvedValue(result(4))
      removeMock.mockResolvedValue(result(3))
      renderControl()
      const menu = await openMenu()
      const box = within(menu).getByRole('checkbox', { name: /^Garden birds/ })

      fireEvent.click(box)
      await screen.findByText('Added to “Garden birds”', {
        selector: '[data-testid="album-toast"] span'
      })
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

      await waitFor(() =>
        expect(screen.getByTestId('album-toast')).toHaveTextContent(
          'Removed from “Garden birds”'
        )
      )
      expect(removeMock).toHaveBeenCalledWith('a2', ['m1'])
      expect(box).not.toBeChecked()
      // Undoing an undo is the checkbox's job, not another Undo.
      expect(
        screen.queryByRole('button', { name: 'Undo' })
      ).not.toBeInTheDocument()
    })

    it('puts a failed add back and says why', async () => {
      addMock.mockRejectedValue(new Error('Server is down'))
      renderControl()
      const menu = await openMenu()
      const box = within(menu).getByRole('checkbox', { name: /^Garden birds/ })

      fireEvent.click(box)
      expect(box).toBeChecked()

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(
        'Couldn’t add to “Garden birds”. Server is down'
      )
      expect(box).not.toBeChecked()
      expect(screen.queryByTestId('album-toast')).not.toBeInTheDocument()
      // The count the toggle changed is back where it was.
      expect(within(menu).getByText('3', { selector: 'span' })).toBeVisible()
    })

    it('puts a failed removal back and says why', async () => {
      removeMock.mockRejectedValue(new Error('Server is down'))
      renderControl()
      const menu = await openMenu()
      const box = within(menu).getAllByRole('checkbox')[0]

      fireEvent.click(box)

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Couldn’t remove from “Kruger”. Server is down'
      )
      expect(box).toBeChecked()
    })

    it('treats a photo the server skipped as a failed add', async () => {
      addMock.mockResolvedValue(result(3, { skipped: ['m1'] }))
      renderControl()
      const menu = await openMenu()
      const box = within(menu).getByRole('checkbox', { name: /^Garden birds/ })

      fireEvent.click(box)

      expect(await screen.findByRole('alert')).toHaveTextContent(
        NOT_ADDABLE_HINT
      )
      expect(box).not.toBeChecked()
    })

    it('ignores a second press while an album is being written', async () => {
      let finish: (value: ReturnType<typeof result>) => void = () => {}
      addMock.mockReturnValue(new Promise((resolve) => (finish = resolve)))
      renderControl()
      const menu = await openMenu()
      const box = within(menu).getByRole('checkbox', { name: /^Garden birds/ })

      fireEvent.click(box)
      fireEvent.click(box)
      await act(async () => finish(result(4)))

      expect(addMock).toHaveBeenCalledTimes(1)
      expect(removeMock).not.toHaveBeenCalled()
    })

    it('clears the previous error when the next change starts', async () => {
      addMock.mockRejectedValueOnce(new Error('Server is down'))
      addMock.mockResolvedValueOnce(result(4))
      renderControl()
      const menu = await openMenu()
      const box = within(menu).getByRole('checkbox', { name: /^Garden birds/ })

      fireEvent.click(box)
      await screen.findByRole('alert')
      fireEvent.click(box)

      await waitFor(() =>
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      )
      await screen.findByTestId('album-toast')
    })

    it('keeps the message in reach: inside the menu while it is open, under the row after', async () => {
      addMock.mockResolvedValue(result(4))
      renderControl()
      const menu = await openMenu()

      fireEvent.click(
        within(menu).getByRole('checkbox', { name: /^Garden birds/ })
      )
      const toast = await screen.findByTestId('album-toast')
      expect(menu).toContainElement(toast)

      fireEvent.keyDown(menu, { key: 'Escape' })
      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: 'Add to album' })
        ).not.toBeInTheDocument()
      )
      expect(screen.getByTestId('album-toast')).toHaveTextContent(
        'Added to “Garden birds”'
      )
    })

    it('shows a failed change inside the menu too', async () => {
      addMock.mockRejectedValue(new Error('Server is down'))
      renderControl()
      const menu = await openMenu()

      fireEvent.click(
        within(menu).getByRole('checkbox', { name: /^Garden birds/ })
      )

      expect(await within(menu).findByRole('alert')).toHaveTextContent(
        'Server is down'
      )
    })

    it('dismisses the message', async () => {
      addMock.mockResolvedValue(result(4))
      renderControl()
      const menu = await openMenu()

      fireEvent.click(
        within(menu).getByRole('checkbox', { name: /^Garden birds/ })
      )
      await screen.findByTestId('album-toast')
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

      expect(screen.queryByTestId('album-toast')).not.toBeInTheDocument()
    })
  })

  describe('a photo that cannot be added', () => {
    beforeEach(() => {
      getMediaAlbumsMock.mockResolvedValue(response({ addable: false }))
    })

    it('stops adding, explains why, and still lets the photo be taken out', async () => {
      removeMock.mockResolvedValue(result(13))
      renderControl()
      const menu = await openMenu()
      const [member, other] = within(menu).getAllByRole('checkbox')

      expect(other).toBeDisabled()
      expect(member).toBeEnabled()
      expect(menu).toHaveTextContent(NOT_ADDABLE_HINT)
      expect(
        within(menu).getByRole('button', { name: 'New album with this photo' })
      ).toBeDisabled()

      fireEvent.click(member)
      await waitFor(() => expect(removeMock).toHaveBeenCalledWith('a1', ['m1']))
    })

    it('says so beside the row too', async () => {
      renderControl()

      expect(
        await screen.findByText(/can’t be added to an album/)
      ).toBeVisible()
    })
  })

  describe('New album with this photo', () => {
    it('closes the menu and opens the create dialog with the photo chosen', async () => {
      renderControl()
      const menu = await openMenu()

      fireEvent.click(
        within(menu).getByRole('button', { name: 'New album with this photo' })
      )

      expect(
        await screen.findByRole('dialog', { name: 'New album' })
      ).toBeVisible()
      expect(formDialogProps.current?.initialMediaIds).toEqual(['m1'])
      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: 'Add to album' })
        ).not.toBeInTheDocument()
      )
    })

    it('reads the albums again once the new album is saved', async () => {
      renderControl()
      const menu = await openMenu()
      fireEvent.click(
        within(menu).getByRole('button', { name: 'New album with this photo' })
      )
      getMediaAlbumsMock.mockResolvedValue(
        response({
          albums: [
            ...response().albums,
            { id: 'a4', title: 'Fresh', visibility: 'public', itemCount: 1 }
          ],
          albumIds: ['a1', 'a4']
        })
      )

      await act(async () => formDialogProps.current?.onSaved('a4'))

      expect(getMediaAlbumsMock).toHaveBeenCalledTimes(2)
      expect(
        await screen.findByRole('link', { name: /Fresh/ })
      ).toBeInTheDocument()
    })
  })

  describe('pill', () => {
    it('counts the albums that hold the photo', async () => {
      renderControl('pill')

      expect(
        await screen.findByRole('button', { name: 'In 1 album' })
      ).toBeVisible()
    })

    it('invites an add when the photo is in no album', async () => {
      getMediaAlbumsMock.mockResolvedValue(response({ albumIds: [] }))
      renderControl('pill')

      expect(
        await screen.findByRole('button', { name: 'Add to album' })
      ).toBeVisible()
    })

    it('shows nothing while loading, and nothing for a photo that is not the caller’s', async () => {
      getMediaAlbumsMock.mockResolvedValue(null)
      const { container } = renderControl('pill')

      expect(container).toBeEmptyDOMElement()
      await act(async () => {})
      expect(container).toBeEmptyDOMElement()
    })

    it('marks its menu so the lightbox leaves the arrow keys to it', async () => {
      renderControl('pill')
      const menu = await openMenu('In 1 album')

      expect(menu).toHaveAttribute('data-albums-menu')
    })

    it('adds from the menu with a dark toast', async () => {
      addMock.mockResolvedValue(result(4))
      renderControl('pill')
      const menu = await openMenu('In 1 album')

      fireEvent.click(
        within(menu).getByRole('checkbox', { name: /^Garden birds/ })
      )

      expect(await screen.findByTestId('album-toast')).toHaveClass(
        'bg-neutral-800'
      )
      expect(
        await screen.findByRole('button', { name: 'In 2 albums' })
      ).toBeVisible()
    })
  })

  it('reads again for another photo and drops the earlier photo’s late answer', async () => {
    let answerFirst: (value: MediaAlbumsResponse) => void = () => {}
    getMediaAlbumsMock.mockReturnValueOnce(
      new Promise((resolve) => (answerFirst = resolve))
    )
    getMediaAlbumsMock.mockResolvedValueOnce(
      response({ albums: [], albumIds: [] })
    )
    const { rerender } = renderControl()

    rerender(<MediaAlbumsControl mediaId="m2" ownerId="owner" variant="row" />)
    await screen.findByText('Not in any album yet.')
    await act(async () => answerFirst(response()))

    expect(getMediaAlbumsMock).toHaveBeenNthCalledWith(2, 'm2')
    expect(screen.getByText('Not in any album yet.')).toBeVisible()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })
})
