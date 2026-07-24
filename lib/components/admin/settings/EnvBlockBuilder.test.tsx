/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'

import { EnvBlockBuilder } from './EnvBlockBuilder'

const STORAGE_AREA = 'Media storage — filesystem or S3'
const MAPS_AREA = 'Fitness maps — route maps & heatmaps'

// Only the selected area is exposed to the accessibility tree, so scoping by
// group keeps every assertion pointed at what the admin can actually see.
const activeArea = (label: string) =>
  within(screen.getByRole('group', { name: label }))

const selectArea = (label: string) =>
  fireEvent.change(screen.getByLabelText('Environment area'), {
    target: { value: label }
  })

// jsdom has no Clipboard API, so the copy path needs one to write into.
const writeText = vi.fn().mockResolvedValue(undefined)

describe('EnvBlockBuilder', () => {
  beforeEach(() => {
    writeText.mockClear()
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  it('says the Update button above does not save anything here', () => {
    render(<EnvBlockBuilder />)
    expect(
      screen.getByText(/does not save any of this/, { exact: false })
    ).toHaveTextContent(
      'the server reads storage from the environment at boot, never from the database'
    )
  })

  // Every variable name renders twice when it is in the block: once as the
  // field's (or selector's) help, once in the block itself. Asserting the pair
  // — rather than "at least one" — is what actually pins block membership.
  it('starts on media storage with the S3 block', () => {
    render(<EnvBlockBuilder />)
    const area = activeArea(STORAGE_AREA)
    expect(area.getByLabelText('Storage type')).toHaveValue('s3')
    expect(area.getAllByText('ACTIVITIES_MEDIA_STORAGE_TYPE')).toHaveLength(2)
    expect(area.getByText('s3')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: MAPS_AREA })).toBeNull()
  })

  it('swaps the fields when the storage type changes', () => {
    render(<EnvBlockBuilder />)
    const area = activeArea(STORAGE_AREA)
    expect(area.getByLabelText('Bucket')).toBeInTheDocument()

    fireEvent.change(area.getByLabelText('Storage type'), {
      target: { value: 'fs' }
    })

    expect(area.queryByLabelText('Bucket')).toBeNull()
    expect(area.getByLabelText('Media directory')).toBeInTheDocument()
  })

  it('leaves an optional variable out of the block until it has a value', () => {
    render(<EnvBlockBuilder />)
    const area = activeArea(STORAGE_AREA)

    // A variable name appears once as the field's help and once more in the
    // preview. Required variables carry their placeholder as a visible to-do;
    // the optional endpoint is absent from the block entirely.
    expect(area.getAllByText('ACTIVITIES_MEDIA_STORAGE_BUCKET')).toHaveLength(2)
    expect(area.getAllByText('ACTIVITIES_MEDIA_STORAGE_ENDPOINT')).toHaveLength(
      1
    )

    fireEvent.change(
      area.getByLabelText('Endpoint — optional, for R2 / MinIO'),
      { target: { value: 'https://minio.example' } }
    )

    expect(area.getAllByText('ACTIVITIES_MEDIA_STORAGE_ENDPOINT')).toHaveLength(
      2
    )
    expect(area.getByText('https://minio.example')).toBeInTheDocument()
  })

  // Layout regression jsdom cannot see: while the copy button was absolutely
  // positioned over the block, it covered the tail of the first line and no
  // amount of horizontal scrolling could reveal it (a `pre`'s scroll extent is
  // max(clientWidth, longest line), so end-side padding buys nothing). Keeping
  // the button in normal flow ahead of the block is what makes that impossible.
  it('keeps the copy button in flow above the block, never overlaying it', () => {
    render(<EnvBlockBuilder />)
    const area = activeArea(STORAGE_AREA)
    const button = area.getByRole('button', { name: 'Copy .env block' })
    const block = area.getByText('ACTIVITIES_MEDIA_STORAGE_BUCKET', {
      selector: 'pre span'
    })
    const pre = block.closest('pre') as HTMLElement

    expect(pre.contains(button)).toBe(false)
    expect(button.className).not.toContain('absolute')
    expect(pre.className).not.toContain('pr-')
    expect(
      button.compareDocumentPosition(pre) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('masks a secret in the preview', () => {
    render(<EnvBlockBuilder />)
    const area = activeArea(STORAGE_AREA)

    fireEvent.change(area.getByLabelText('Secret access key'), {
      target: { value: 'super-secret-value' }
    })

    // The mask is fixed-width, so it leaks nothing about the real length.
    expect(area.getByText('••••••••••••')).toBeInTheDocument()
    expect(area.queryByText('super-secret-value')).toBeNull()
  })

  it('masks a short secret to the same width as a long one', () => {
    render(<EnvBlockBuilder />)
    const area = activeArea(STORAGE_AREA)

    fireEvent.change(area.getByLabelText('Secret access key'), {
      target: { value: 'abc' }
    })

    expect(area.getByText('••••••••••••')).toBeInTheDocument()
  })

  it('copies the real secret rather than the mask', async () => {
    render(<EnvBlockBuilder />)
    const area = activeArea(STORAGE_AREA)
    fireEvent.change(area.getByLabelText('Secret access key'), {
      target: { value: 'super-secret-value' }
    })
    fireEvent.click(area.getByRole('button', { name: 'Copy .env block' }))

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining('AWS_SECRET_ACCESS_KEY=super-secret-value')
      )
    )
    expect(writeText.mock.calls[0][0]).toContain(
      'ACTIVITIES_MEDIA_STORAGE_TYPE=s3'
    )
  })

  it('switches to the fitness map provider block', () => {
    render(<EnvBlockBuilder />)
    selectArea('maps')

    const area = activeArea(MAPS_AREA)
    expect(area.getByLabelText('Map provider')).toHaveValue('mapbox')
    expect(area.getAllByText('ACTIVITIES_FITNESS_MAP_PROVIDER')).toHaveLength(2)
    expect(area.getByText('mapbox')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: STORAGE_AREA })).toBeNull()
    expect(
      screen.getByText(/does not save any of this/, { exact: false })
    ).toHaveTextContent('the server reads fitness maps from the environment')
  })

  it('drops the credential fields for keyless OpenStreetMap', () => {
    render(<EnvBlockBuilder />)
    selectArea('maps')

    const area = activeArea(MAPS_AREA)
    expect(area.getByLabelText('Access token')).toBeInTheDocument()

    fireEvent.change(area.getByLabelText('Map provider'), {
      target: { value: 'osm' }
    })

    expect(area.queryByLabelText('Access token')).toBeNull()
    expect(
      area.getByText(/OpenStreetMap needs no credentials/, { exact: false })
    ).toBeInTheDocument()
    // The provider line is the whole block for osm — losing it would leave an
    // empty block, which no other assertion here would notice.
    expect(area.getAllByText('ACTIVITIES_FITNESS_MAP_PROVIDER')).toHaveLength(2)
    expect(area.getByText('osm')).toBeInTheDocument()
  })

  it('keeps what was typed when the area changes and changes back', () => {
    render(<EnvBlockBuilder />)
    fireEvent.change(activeArea(STORAGE_AREA).getByLabelText('Bucket'), {
      target: { value: 'media.example.social' }
    })

    selectArea('maps')
    selectArea('storage')

    expect(activeArea(STORAGE_AREA).getByLabelText('Bucket')).toHaveValue(
      'media.example.social'
    )
  })
})
