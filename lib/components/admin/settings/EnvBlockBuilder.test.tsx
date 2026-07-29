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

import { ENV_TEMPLATE_AREAS } from '@/lib/config/environmentTemplates'

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
    // preview. Required variables are listed empty as a visible to-do; the
    // optional endpoint is absent from the block entirely.
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

  // The invariant that keeps an unfilled block from booting a real
  // configuration, checked against the string the COPY button actually writes
  // — the preview's textContent has no newlines, so scraping it cannot see
  // individual lines at all, and splitting it yields one concatenated blob that
  // can only ever observe the last value.
  //
  // A placeholder is the *input's* example; emitting it as the value produced
  // lines an operator could paste verbatim and have work.
  // `ACTIVITIES_MEDIA_STORAGE_BUCKET=media.example.social` would point a live
  // instance's uploads at a bucket nobody involved owns. A `defaultValue` is
  // the exception and is emitted, because it is a correct value rather than an
  // example.
  describe.each(
    ENV_TEMPLATE_AREAS.flatMap((area) =>
      area.choices.map((choice) => ({
        area: area.value,
        label: area.label,
        choice: choice.value,
        selectorName: area.selectorName,
        selectorLabel: area.selectorLabel,
        fields: choice.fields
      }))
    )
  )(
    '$area/$choice block',
    ({ area, label, choice, selectorName, selectorLabel, fields }) => {
      const copiedBlock = async (typed?: Record<string, string>) => {
        render(<EnvBlockBuilder />)
        selectArea(area)
        const scope = activeArea(label)
        // The descriptor's own label, not a regex guess: a third area, or a field
        // ever labelled "Endpoint type", would break or double-match a pattern.
        fireEvent.change(scope.getByLabelText(selectorLabel), {
          target: { value: choice }
        })
        for (const [fieldLabel, value] of Object.entries(typed ?? {})) {
          fireEvent.change(scope.getByLabelText(fieldLabel), {
            target: { value }
          })
        }
        fireEvent.click(scope.getByRole('button', { name: 'Copy .env block' }))
        await waitFor(() => expect(writeText).toHaveBeenCalled())
        return writeText.mock.calls.at(-1)![0] as string
      }

      const required = fields.filter((field) => !field.optional)

      it('lists every required variable and no optional one', async () => {
        const block = await copiedBlock()
        const names = block.split('\n').map((line) => line.split('=')[0])

        for (const field of required) expect(names).toContain(field.name)
        for (const field of fields.filter((f) => f.optional)) {
          expect(names).not.toContain(field.name)
        }
        expect(names).toContain(selectorName)
        // Guards the vacuous pass: an empty block satisfies every "not present"
        // assertion above on its own.
        expect(names.filter(Boolean).length).toBe(required.length + 1)
      })

      // A placeholder may only reach the block when it is *also* the field's
      // declared default — i.e. a correct value that happens to double as the
      // example, like `./uploads`. Anything else is someone else's bucket, token
      // or key. `environmentTemplates.test.ts` pins which fields are allowed that
      // exemption, by name and value, so this skip cannot be widened silently.
      it.each(fields.map((field) => ({ field })))(
        'never emits $field.name as its placeholder',
        async ({ field }) => {
          const block = await copiedBlock()
          const line = block
            .split('\n')
            .find((candidate) => candidate.startsWith(`${field.name}=`))
          if (!line || field.defaultValue === field.placeholder) return
          expect(line.slice(field.name.length + 1)).not.toBe(field.placeholder)
        }
      )

      it('leaves an unfilled required variable empty unless it has a default', async () => {
        const block = await copiedBlock()

        for (const field of required) {
          const line = block
            .split('\n')
            // The non-null assertion is load-bearing: softening it to `?.` would
            // make this test pass vacuously for a variable missing from the
            // block entirely. That case must throw.
            .find((candidate) => candidate.startsWith(`${field.name}=`))!
          expect(line.slice(field.name.length + 1)).toBe(
            field.defaultValue ?? ''
          )
        }
      })

      // The third branch of `value || field.defaultValue || ''`. Without this a
      // field that HAS a default is never typed into anywhere in the suite, so
      // reordering to `field.defaultValue || value` — which silently discards
      // everything the admin types into "Media directory" — stays green.
      it.each(required.map((field) => ({ field })))(
        'emits what was typed into $field.name, over any default',
        async ({ field }) => {
          const typedValue = `/typed/${field.name.toLowerCase()}`
          const block = await copiedBlock({ [field.label]: typedValue })

          expect(block).toContain(`${field.name}=${typedValue}`)
        }
      )

      // Trimming runs before the `||`, so whitespace is not a value and the
      // default (or emptiness) must win — never `NAME=   `.
      it.each(required.map((field) => ({ field })))(
        'treats a whitespace-only $field.name as unfilled',
        async ({ field }) => {
          const block = await copiedBlock({ [field.label]: '   ' })
          const line = block
            .split('\n')
            .find((candidate) => candidate.startsWith(`${field.name}=`))!

          expect(line.slice(field.name.length + 1)).toBe(
            field.defaultValue ?? ''
          )
        }
      )
    }
  )
})
