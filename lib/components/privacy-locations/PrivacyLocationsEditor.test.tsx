/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { createDeferred } from '@/lib/testing/deferred'
import { loadMaplibreModule } from '@/lib/utils/maplibre'

import {
  type PrivacyLocationInput,
  type PrivacyLocationsCopy,
  PrivacyLocationsEditor,
  PrivacyLocationsSaveError
} from './PrivacyLocationsEditor'

vi.mock('@/lib/utils/mapbox', () => ({
  loadMapboxModule: vi.fn(() => new Promise(() => {}))
}))
vi.mock('@/lib/utils/maplibre', () => ({
  loadMaplibreModule: vi.fn(() => new Promise(() => {})),
  OPENFREEMAP_STYLE_URL: 'https://tiles.openfreemap.org/styles/bright',
  OPENFREEMAP_HEATMAP_STYLE_URL: 'https://tiles.openfreemap.org/styles/positron'
}))

const copy: PrivacyLocationsCopy = {
  saved: 'Custom saved.',
  cleared: 'Custom cleared.',
  saveFailed: 'Custom save failure',
  saveButton: 'Save custom places',
  hideRadiusHelp: 'Custom radius help.'
}

const home: PrivacyLocationInput = {
  latitude: 13.7563,
  longitude: 100.5018,
  hideRadiusMeters: 500
}

const renderEditor = (
  props: Partial<Parameters<typeof PrivacyLocationsEditor>[0]> = {}
) => {
  const load = vi.fn().mockResolvedValue([home])
  const save = vi.fn(async (locations: PrivacyLocationInput[]) => locations)
  const view = render(
    <PrivacyLocationsEditor
      mapProvider={{ type: 'osm' }}
      load={load}
      save={save}
      copy={copy}
      mapIdPrefix="custom-zones"
      {...props}
    />
  )
  return { load, save, ...view }
}

describe('PrivacyLocationsEditor', () => {
  afterEach(() => {
    vi.mocked(loadMaplibreModule).mockImplementation(
      () => new Promise(() => {})
    )
  })

  it('reads the saved locations through load and fills the list', async () => {
    const { load } = renderEditor()

    expect(await screen.findByText('13.756300, 100.501800')).toBeInTheDocument()
    expect(screen.getByText('Hide radius: 500m')).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Custom radius help.')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Save custom places' })
    ).toBeInTheDocument()
  })

  it('does not read again when the parent re-renders with new adapters', async () => {
    const { load, rerender } = renderEditor()
    await screen.findByText('13.756300, 100.501800')

    rerender(
      <PrivacyLocationsEditor
        mapProvider={{ type: 'osm' }}
        load={vi.fn()}
        save={vi.fn()}
        copy={copy}
        mapIdPrefix="custom-zones"
      />
    )

    expect(load).toHaveBeenCalledTimes(1)
    expect(screen.getByText('13.756300, 100.501800')).toBeInTheDocument()
  })

  it('saves the stored list through save and shows the surface-specific message', async () => {
    const { save } = renderEditor()
    await screen.findByText('13.756300, 100.501800')

    fireEvent.click(screen.getByRole('button', { name: 'Save custom places' }))

    expect(await screen.findByText('Custom saved.')).toBeInTheDocument()
    expect(save).toHaveBeenCalledWith([home])
  })

  it('passes the stored list, with the draft added once, to save', async () => {
    const save = vi.fn(async (locations: PrivacyLocationInput[]) => locations)
    renderEditor({ save })
    await screen.findByText('13.756300, 100.501800')

    fireEvent.change(screen.getByLabelText('Latitude'), {
      target: { value: '52.1' }
    })
    fireEvent.change(screen.getByLabelText('Longitude'), {
      target: { value: '5.3' }
    })
    fireEvent.change(screen.getByLabelText('Hide Radius'), {
      target: { value: '200' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save custom places' }))

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith([
        home,
        { latitude: 52.1, longitude: 5.3, hideRadiusMeters: 200 }
      ])
    )
    expect(await screen.findByText('Custom saved.')).toBeInTheDocument()
  })

  it('clears through save with an empty list and says so', async () => {
    const save = vi.fn(async (locations: PrivacyLocationInput[]) => locations)
    renderEditor({ save })
    await screen.findByText('13.756300, 100.501800')

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))

    await waitFor(() => expect(save).toHaveBeenCalledWith([]))
    expect(await screen.findByText('Custom cleared.')).toBeInTheDocument()
    expect(screen.getByText('No privacy locations added yet.')).toBeVisible()
  })

  it('shows the message of a PrivacyLocationsSaveError and the copy for any other failure', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new PrivacyLocationsSaveError('Too many places'))
      .mockRejectedValueOnce(new Error('socket hang up'))
    renderEditor({ save })
    await screen.findByText('13.756300, 100.501800')

    fireEvent.click(screen.getByRole('button', { name: 'Save custom places' }))
    expect(await screen.findByText('Too many places')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save custom places' }))
    expect(await screen.findByText('Custom save failure')).toBeInTheDocument()
    expect(screen.queryByText('socket hang up')).not.toBeInTheDocument()
  })

  it('ties a coordinate mistake to its field instead of raising an alert', async () => {
    const save = vi.fn(async (locations: PrivacyLocationInput[]) => locations)
    renderEditor({ save, load: vi.fn().mockResolvedValue([]) })
    await screen.findByText('No privacy locations added yet.')

    fireEvent.change(screen.getByLabelText('Latitude'), {
      target: { value: '95' }
    })
    fireEvent.change(screen.getByLabelText('Longitude'), {
      target: { value: '100' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save custom places' }))

    expect(screen.getByLabelText('Latitude')).toHaveAccessibleDescription(
      'Latitude must be between -90 and 90.'
    )
    expect(screen.getByLabelText('Latitude')).toBeInvalid()
    expect(screen.getByLabelText('Longitude')).toHaveAccessibleDescription(
      'Latitude must be between -90 and 90.'
    )
    expect(screen.getByLabelText('Latitude')).toHaveFocus()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()

    // Editing a coordinate clears the error and the invalid state.
    fireEvent.change(screen.getByLabelText('Latitude'), {
      target: { value: '45' }
    })
    expect(screen.getByLabelText('Latitude')).not.toBeInvalid()
    expect(screen.getByLabelText('Longitude')).not.toBeInvalid()
    expect(
      screen.queryByText('Latitude must be between -90 and 90.')
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save custom places' }))

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(screen.getByLabelText('Latitude')).not.toBeInvalid()
  })

  it('keeps editing disabled, and retries the load, after a failed read', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce([home])
    const save = vi.fn()
    renderEditor({ load, save })

    expect(
      await screen.findByText(/Failed to load your saved privacy locations/)
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Save custom places' })
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }))

    expect(await screen.findByText('13.756300, 100.501800')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Save custom places' })
    ).toBeEnabled()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('reports whether editing is disabled to its parent', async () => {
    const onEditingDisabledChange = vi.fn()
    const deferred = createDeferred<PrivacyLocationInput[]>()
    renderEditor({
      load: vi.fn(() => deferred.promise),
      onEditingDisabledChange
    })

    expect(onEditingDisabledChange).toHaveBeenLastCalledWith(true)

    deferred.resolve([home])
    await screen.findByText('13.756300, 100.501800')
    expect(onEditingDisabledChange).toHaveBeenLastCalledWith(false)
  })

  it('disables the editing surface while a save is in flight', async () => {
    const deferred = createDeferred<PrivacyLocationInput[]>()
    renderEditor({ save: vi.fn(() => deferred.promise) })
    await screen.findByText('13.756300, 100.501800')

    fireEvent.click(screen.getByRole('button', { name: 'Save custom places' }))

    expect(
      await screen.findByRole('button', { name: 'Saving…' })
    ).toBeDisabled()
    expect(screen.getByLabelText('Latitude')).toBeDisabled()

    deferred.resolve([home])
    expect(await screen.findByText('Custom saved.')).toBeInTheDocument()
    expect(screen.getByLabelText('Latitude')).toBeEnabled()
  })

  it('hands a function footer the shared state and lets it join the busy state', async () => {
    const message = createDeferred<void>()
    renderEditor({
      footer: ({ disabled, busy, setBusy, setMessage }) => (
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => {
            setBusy(true)
            message.promise.then(() => {
              setMessage('Footer done.')
              setBusy(false)
            })
          }}
        >
          {busy ? 'Footer working' : 'Footer action'}
        </button>
      )
    })

    const footerButton = await screen.findByRole('button', {
      name: 'Footer action'
    })
    await waitFor(() => expect(footerButton).toBeEnabled())

    fireEvent.click(footerButton)

    expect(
      await screen.findByRole('button', { name: 'Footer working' })
    ).toBeDisabled()
    // The editor's own actions wait for the footer's work.
    expect(
      screen.getByRole('button', { name: 'Save custom places' })
    ).toBeDisabled()

    message.resolve()
    expect(await screen.findByText('Footer done.')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Save custom places' })
    ).toBeEnabled()
  })

  it('renders a plain node footer as is', async () => {
    renderEditor({ footer: <span>Extra footer</span> })

    expect(await screen.findByText('Extra footer')).toBeInTheDocument()
  })

  it('derives the GL source and layer ids from mapIdPrefix', async () => {
    const layers: string[] = []
    const sources: string[] = []
    vi.mocked(loadMaplibreModule).mockResolvedValue({
      Map: vi.fn(function MapStub() {
        return {
          addSource: vi.fn((id: string) => sources.push(id)),
          addLayer: vi.fn((layer: { id: string }) => layers.push(layer.id)),
          getSource: vi.fn(() => ({ setData: vi.fn() })),
          once: (_event: 'load', listener: () => void) => listener(),
          on: vi.fn(),
          flyTo: vi.fn(),
          remove: vi.fn()
        }
      })
    } as never)

    renderEditor()

    await waitFor(() => expect(layers).toHaveLength(3))
    expect(sources).toEqual(['custom-zones-home-marker', 'custom-zones-zones'])
    expect(layers).toEqual([
      'custom-zones-zone-fill',
      'custom-zones-zone-outline',
      'custom-zones-home-marker-core'
    ])
  })
})
