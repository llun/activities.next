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
import { useReducer } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatRange } from '@/lib/fitness/calendar/format'
import { DateKey, parseDateKey } from '@/lib/fitness/calendar/localDay'
import {
  createOverviewState,
  overviewReducer
} from '@/lib/fitness/calendar/overviewState'
import { AppliedRange } from '@/lib/fitness/calendar/ranges'

import { RangePicker, rangeTriggerLabel } from './RangePicker'

const TODAY = parseDateKey('2026-10-04') as DateKey
const YEARS = [2026, 2025, 2024]

interface HarnessProps {
  presentation?: 'auto' | 'popover' | 'sheet'
  compact?: boolean
}

function Harness({ presentation = 'sheet', compact }: HarnessProps) {
  const [state, dispatch] = useReducer(
    overviewReducer,
    createOverviewState(TODAY)
  )
  return (
    <div>
      <p data-testid="applied">
        {state.applied.kind}:{formatRange(state.applied.from, state.applied.to)}
      </p>
      <RangePicker
        applied={state.applied}
        today={state.today}
        draft={state.picker}
        years={YEARS}
        presentation={presentation}
        compact={compact}
        onOpen={() => dispatch({ type: 'OPEN_PICKER' })}
        onChoosePreset={(preset) => dispatch({ type: 'CHOOSE_PRESET', preset })}
        onEditDraft={(field, text) =>
          dispatch({ type: 'EDIT_DRAFT', field, text })
        }
        onCancel={() => dispatch({ type: 'CANCEL_PICKER' })}
        onApply={() => dispatch({ type: 'APPLY_PICKER' })}
        onSelectYear={(year) => dispatch({ type: 'APPLY_YEAR', year })}
      />
    </div>
  )
}

const trigger = () => screen.getByTestId('range-picker-trigger')
const open = () => fireEvent.click(trigger())
const from = () => screen.getByLabelText('From') as HTMLInputElement
const to = () => screen.getByLabelText('To') as HTMLInputElement
const apply = () => screen.getByRole('button', { name: 'Apply' })
const applied = () => screen.getByTestId('applied').textContent

describe('RangePicker', () => {
  beforeEach(() => {
    // Radix Popper observes its content's size; jsdom has no ResizeObserver.
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: vi.fn().mockImplementation(function () {
        return {
          disconnect: vi.fn(),
          observe: vi.fn(),
          unobserve: vi.fn()
        }
      })
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'ResizeObserver')
    vi.restoreAllMocks()
  })

  it.each([
    ['9999-12-15', 'October 2026'],
    ['2030-01-15', 'October 2026'],
    ['0001-01-05', 'January 1970']
  ])(
    'keeps the grid on an offered month when From is typed as %s',
    (typed, title) => {
      render(<Harness />)
      open()
      fireEvent.change(from(), { target: { value: typed } })
      expect(from()).toHaveValue(typed)
      expect(screen.getByTestId('mini-month-title')).toHaveTextContent(title)
    }
  )

  describe('trigger', () => {
    const range = (kind: AppliedRange['kind'], from: string, to: string) =>
      ({
        kind,
        from: parseDateKey(from),
        to: parseDateKey(to)
      }) as AppliedRange

    it.each<[AppliedRange, string]>([
      [range('this_month', '2026-10-01', '2026-10-04'), 'This month'],
      [range('ytd', '2026-01-01', '2026-10-04'), 'Year to date'],
      [range('last_12_months', '2025-10-05', '2026-10-04'), 'Last 12 months'],
      [range('month', '2026-09-01', '2026-09-30'), 'September 2026'],
      [range('year', '2025-01-01', '2025-12-31'), 'Year 2025'],
      [range('custom', '2026-03-02', '2026-04-20'), 'Custom range']
    ])('names %j as %s', (applied, label) => {
      expect(rangeTriggerLabel(applied)).toBe(label)
    })

    it('has an accessible name that says which span is applied', () => {
      render(<Harness />)
      expect(trigger()).toHaveAccessibleName('Date range: Year to date')
      expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    })

    it('keeps the full name when compact', () => {
      render(<Harness compact />)
      expect(trigger()).toHaveAccessibleName('Date range: Year to date')
      expect(trigger()).toHaveTextContent('Range')
    })
  })

  describe.each(['popover', 'sheet'] as const)('%s presentation', (mode) => {
    it('opens with the presets, year chooser, From/To, calendar and actions', () => {
      render(<Harness presentation={mode} />)
      open()

      expect(trigger()).toHaveAttribute('aria-expanded', 'true')
      for (const name of [
        'This month',
        'Year to date',
        'Last 12 months',
        'Custom'
      ]) {
        expect(screen.getByRole('button', { name })).toBeInTheDocument()
      }
      expect(
        screen.getByRole('button', { name: 'Year to date' })
      ).toHaveAttribute('aria-pressed', 'true')
      expect(from()).toHaveValue('2026-01-01')
      expect(to()).toHaveValue('2026-10-04')
      expect(screen.getByText('Calendar year')).toBeInTheDocument()
      expect(screen.getByTestId('mini-month-title')).toHaveTextContent(
        'October 2026'
      )
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
      expect(apply()).toBeEnabled()
      expect(
        screen.getByTestId(
          mode === 'sheet' ? 'range-picker-sheet' : 'range-picker-content'
        )
      ).toBeInTheDocument()
    })

    it('does not apply anything until Apply', () => {
      render(<Harness presentation={mode} />)
      open()
      fireEvent.click(screen.getByRole('button', { name: 'This month' }))

      expect(from()).toHaveValue('2026-10-01')
      expect(applied()).toBe('ytd:1 Jan – 4 Oct 2026')

      fireEvent.click(apply())
      expect(applied()).toBe('this_month:1 – 4 Oct 2026')
      expect(screen.queryByLabelText('From')).not.toBeInTheDocument()
    })

    it('discards the draft and returns focus to the trigger on Cancel', async () => {
      render(<Harness presentation={mode} />)
      open()
      fireEvent.click(screen.getByRole('button', { name: 'Last 12 months' }))
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(applied()).toBe('ytd:1 Jan – 4 Oct 2026')
      expect(screen.queryByLabelText('From')).not.toBeInTheDocument()
      await waitFor(() => expect(trigger()).toHaveFocus())

      // Reopening starts from the applied range, not the discarded draft.
      open()
      expect(from()).toHaveValue('2026-01-01')
    })

    it('discards the draft and returns focus to the trigger on Escape', async () => {
      render(<Harness presentation={mode} />)
      open()
      fireEvent.change(from(), { target: { value: '2026-03-02' } })
      expect(from()).toHaveValue('2026-03-02')

      fireEvent.keyDown(document.activeElement ?? document.body, {
        key: 'Escape'
      })

      expect(screen.queryByLabelText('From')).not.toBeInTheDocument()
      expect(applied()).toBe('ytd:1 Jan – 4 Oct 2026')
      await waitFor(() => expect(trigger()).toHaveFocus())
    })

    it('shows an inline error per field and disables Apply while invalid', () => {
      render(<Harness presentation={mode} />)
      open()
      fireEvent.change(from(), { target: { value: '2026-09-20' } })
      fireEvent.change(to(), { target: { value: '2026-09-12' } })

      const message = screen.getByText(
        'End date must be on or after the start date'
      )
      expect(message).toBeInTheDocument()
      expect(to()).toHaveAttribute('aria-invalid', 'true')
      expect(to().getAttribute('aria-describedby')).toContain(message.id)
      expect(from().getAttribute('aria-describedby')).toContain(message.id)
      expect(apply()).toBeDisabled()

      // Applying does nothing, including by pressing Enter in a field.
      fireEvent.submit(from().closest('form') as HTMLFormElement)
      expect(applied()).toBe('ytd:1 Jan – 4 Oct 2026')
    })

    it.each([
      ['from', '', 'Enter a start date'],
      ['to', '', 'Enter an end date'],
      ['to', '2026-10-05', "End date can't be after today"],
      [
        'from',
        '2026-10-01',
        'Choose at least 7 days, or use This month or Year to date'
      ]
    ] as const)('maps a %s edit of %j to %j', (field, value, expected) => {
      render(<Harness presentation={mode} />)
      open()
      fireEvent.change(field === 'from' ? from() : to(), {
        target: { value }
      })
      expect(screen.getByText(expected)).toBeInTheDocument()
      expect(apply()).toBeDisabled()
    })

    it('keeps the draft when a custom range is valid and applies it', () => {
      render(<Harness presentation={mode} />)
      open()
      fireEvent.change(from(), { target: { value: '2024-03-15' } })
      expect(screen.getByRole('button', { name: 'Custom' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      expect(screen.getByTestId('mini-month-title')).toHaveTextContent(
        'March 2024'
      )
      expect(apply()).toBeEnabled()
      fireEvent.click(apply())
      expect(applied()).toBe('custom:15 Mar 2024 – 4 Oct 2026')
    })

    it('applies a chosen calendar year directly', async () => {
      render(<Harness presentation={mode} />)
      open()
      const chooser = screen.getByRole('button', { name: /Calendar year/ })
      fireEvent.keyDown(chooser, { key: 'Enter' })
      fireEvent.click(
        await screen.findByRole('menuitemradio', { name: '2025' })
      )

      expect(applied()).toBe('year:1 Jan – 31 Dec 2025')
      expect(screen.queryByLabelText('From')).not.toBeInTheDocument()
    })

    it('shows the From year on the year chooser only when it is an option', () => {
      render(<Harness presentation={mode} />)
      open()
      const chooser = screen.getByRole('button', { name: /Calendar year/ })
      expect(chooser).toHaveTextContent('2026')

      fireEvent.change(from(), { target: { value: '2024-03-15' } })
      expect(chooser).toHaveTextContent('2024')

      // A typed year the chooser does not list is not shown as its value.
      fireEvent.change(from(), { target: { value: '9999-01-01' } })
      expect(chooser).toHaveTextContent('Select year')
      expect(chooser).not.toHaveTextContent('9999')
    })

    it('edits the From then To field from the month grid', () => {
      render(<Harness presentation={mode} />)
      open()
      fireEvent.click(
        screen.getByRole('button', { name: /^Thursday, 1 October 2026/ })
      )
      expect(from()).toHaveValue('2026-10-01')
      fireEvent.click(
        screen.getByRole('button', { name: /^Friday, 2 October 2026/ })
      )
      // To held 2026-10-04 before this tap (the year-to-date default), so
      // only an actual edit of To can make it 2026-10-02.
      expect(from()).toHaveValue('2026-10-01')
      expect(to()).toHaveValue('2026-10-02')
    })

    it('goes back to editing From after a preset is chosen', () => {
      render(<Harness presentation={mode} />)
      open()
      fireEvent.click(
        screen.getByRole('button', { name: /^Thursday, 1 October 2026/ })
      )
      // The next tap would edit To; a preset resets it to From.
      fireEvent.click(screen.getByRole('button', { name: 'This month' }))
      fireEvent.click(
        screen.getByRole('button', { name: /^Friday, 2 October 2026/ })
      )
      expect(from()).toHaveValue('2026-10-02')
    })

    it('shows the preset month again after browsing away and choosing it', () => {
      render(<Harness presentation={mode} />)
      open()
      const calendar = screen.getByTestId('mini-month-calendar')
      fireEvent.click(
        within(calendar).getByRole('button', { name: 'Previous month' })
      )
      expect(screen.getByTestId('mini-month-title')).toHaveTextContent(
        'September 2026'
      )
      fireEvent.click(screen.getByRole('button', { name: 'This month' }))
      expect(screen.getByTestId('mini-month-title')).toHaveTextContent(
        'October 2026'
      )
    })

    it('disables days after today and the next arrow in the current month', () => {
      render(<Harness presentation={mode} />)
      open()
      const calendar = screen.getByTestId('mini-month-calendar')
      expect(
        within(calendar).getByRole('button', {
          name: /^Monday, 5 October 2026/
        })
      ).toBeDisabled()
      expect(
        within(calendar).getByRole('button', {
          name: /^Sunday, 4 October 2026/
        })
      ).toBeEnabled()
      expect(
        within(calendar).getByRole('button', { name: 'Next month' })
      ).toBeDisabled()

      fireEvent.click(
        within(calendar).getByRole('button', { name: 'Previous month' })
      )
      expect(screen.getByTestId('mini-month-title')).toHaveTextContent(
        'September 2026'
      )
      expect(
        within(calendar).getByRole('button', { name: 'Next month' })
      ).toBeEnabled()
    })
  })

  describe('popover', () => {
    it('is a labelled dialog anchored to the trigger', () => {
      render(<Harness presentation="popover" />)
      open()
      expect(
        screen.getByRole('dialog', { name: 'Date range' })
      ).toBeInTheDocument()
      expect(screen.queryByTestId('range-picker-sheet')).not.toBeInTheDocument()
    })

    it('toggles closed from the trigger', async () => {
      render(<Harness presentation="popover" />)
      open()
      expect(screen.getByLabelText('From')).toBeInTheDocument()
      fireEvent.click(trigger())
      expect(screen.queryByLabelText('From')).not.toBeInTheDocument()
      await waitFor(() => expect(trigger()).toHaveFocus())
    })
  })

  describe('sheet', () => {
    it('is a dialog with a title and a Close', () => {
      render(<Harness presentation="sheet" />)
      open()
      const sheet = screen.getByRole('dialog', { name: 'Date range' })
      expect(
        within(sheet).getByRole('button', { name: 'Close date range' })
      ).toBeInTheDocument()
    })

    it('closes (discarding the draft) from the X', async () => {
      render(<Harness presentation="sheet" />)
      open()
      fireEvent.change(from(), { target: { value: '2026-03-02' } })
      fireEvent.click(screen.getByRole('button', { name: 'Close date range' }))
      expect(applied()).toBe('ytd:1 Jan – 4 Oct 2026')
      await waitFor(() => expect(trigger()).toHaveFocus())
    })

    it('never lets the form submit natively', () => {
      render(<Harness presentation="sheet" />)
      open()
      const form = from().closest('form') as HTMLFormElement
      fireEvent.change(from(), { target: { value: '2026-03-02' } })
      // fireEvent returns false when the submit was cancelled, so the browser
      // does not reload the page.
      expect(fireEvent.submit(form)).toBe(false)
    })

    describe('on-screen keyboard', () => {
      const listeners = new Map<string, () => void>()
      const viewport = {
        height: 800,
        offsetTop: 0,
        addEventListener: (type: string, listener: () => void) =>
          listeners.set(type, listener),
        removeEventListener: (type: string) => listeners.delete(type)
      }

      beforeEach(() => {
        Object.defineProperty(window, 'innerHeight', {
          configurable: true,
          value: 800
        })
        Object.defineProperty(window, 'visualViewport', {
          configurable: true,
          value: viewport
        })
      })

      afterEach(() => {
        listeners.clear()
        viewport.height = 800
        viewport.offsetTop = 0
        Reflect.deleteProperty(window, 'visualViewport')
      })

      it('shrinks above the keyboard so Apply and Cancel stay reachable', () => {
        render(<Harness presentation="sheet" />)
        open()
        const sheet = screen.getByRole('dialog', { name: 'Date range' })
        expect(sheet.style.maxHeight).toBe('752px')
        expect(sheet.style.bottom).toBe('0px')

        viewport.height = 420
        act(() => listeners.get('resize')?.())

        expect(sheet.style.maxHeight).toBe('372px')
        // Anchored to the visual viewport's bottom, above the keyboard.
        expect(sheet.style.bottom).toBe('380px')
        expect(apply()).toBeInTheDocument()
        // Only the body scrolls; the actions are outside it.
        const body = from().closest('.overflow-y-auto') as HTMLElement
        expect(body).not.toContainElement(apply())
      })

      it('follows the visual viewport when it pans, and stops listening on unmount', () => {
        const { unmount } = render(<Harness presentation="sheet" />)
        open()
        const sheet = screen.getByRole('dialog', { name: 'Date range' })
        expect(sheet.style.bottom).toBe('0px')
        viewport.height = 420
        viewport.offsetTop = 100
        act(() => listeners.get('scroll')?.())
        expect(sheet.style.bottom).toBe('280px')
        unmount()
        expect(listeners.size).toBe(0)
      })

      it('keeps the focused field in view', () => {
        render(<Harness presentation="sheet" />)
        open()
        const scrollIntoView = vi.fn()
        from().scrollIntoView = scrollIntoView
        fireEvent.focus(from())
        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
      })
    })
  })

  describe('automatic presentation', () => {
    const setViewport = (width: number, height: number) => {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: width
      })
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: height
      })
    }

    beforeEach(() => {
      vi.spyOn(
        HTMLElement.prototype,
        'getBoundingClientRect'
      ).mockImplementation(function (this: HTMLElement) {
        const box =
          this.dataset.testid === 'range-picker-trigger'
            ? { left: 960, right: 1160, top: 100, bottom: 140 }
            : { left: 0, right: 0, top: 0, bottom: 0 }
        return {
          ...box,
          x: box.left,
          y: box.top,
          width: box.right - box.left,
          height: box.bottom - box.top,
          toJSON: () => ({})
        }
      })
    })

    afterEach(() => {
      setViewport(1024, 768)
    })

    it('anchors a popover when the whole panel fits', () => {
      setViewport(1194, 834)
      render(<Harness presentation="auto" />)
      open()
      expect(screen.queryByTestId('range-picker-sheet')).not.toBeInTheDocument()
      expect(screen.getByLabelText('From')).toBeInTheDocument()
      expect(
        screen.getByRole('dialog', { name: 'Date range' })
      ).toHaveAttribute('data-slot', 'popover-content')
    })

    it('uses the sheet when the viewport is too narrow', () => {
      setViewport(390, 844)
      render(<Harness presentation="auto" />)
      open()
      expect(screen.getByTestId('range-picker-sheet')).toBeInTheDocument()
    })

    describe('inside the main column (real measured geometry)', () => {
      // `main` spans the viewport and reserves the 72px rail as padding; the
      // Range button sits in the page header 16px in from the right edge.
      const renderInMain = (viewportWidth: number, height: number) => {
        setViewport(viewportWidth, height)
        vi.mocked(
          HTMLElement.prototype.getBoundingClientRect
        ).mockImplementation(function (this: HTMLElement) {
          const box =
            this.dataset.testid === 'range-picker-trigger'
              ? {
                  left: viewportWidth - 169,
                  right: viewportWidth - 16,
                  top: 155,
                  bottom: 199
                }
              : this.tagName === 'MAIN'
                ? { left: 0, right: viewportWidth, top: 0, bottom: 2100 }
                : { left: 0, right: 0, top: 0, bottom: 0 }
          return {
            ...box,
            x: box.left,
            y: box.top,
            width: box.right - box.left,
            height: box.bottom - box.top,
            toJSON: () => ({})
          }
        })
        render(
          <main style={{ paddingLeft: '72px' }}>
            <Harness presentation="auto" />
          </main>
        )
        open()
      }

      it('uses the sheet at 834 x 1194, where the column is 762px', () => {
        renderInMain(834, 1194)
        expect(screen.getByTestId('range-picker-sheet')).toBeInTheDocument()
      })

      it('anchors the popover at 1194 x 834, where the column is 1122px', () => {
        renderInMain(1194, 834)
        expect(
          screen.queryByTestId('range-picker-sheet')
        ).not.toBeInTheDocument()
        expect(
          screen.getByRole('dialog', { name: 'Date range' })
        ).toHaveAttribute('data-slot', 'popover-content')
      })
    })

    it('keeps the draft, the visible month and the focused field when the presentation switches', async () => {
      setViewport(1194, 834)
      render(<Harness presentation="auto" />)
      open()
      expect(screen.queryByTestId('range-picker-sheet')).not.toBeInTheDocument()

      fireEvent.change(from(), { target: { value: '2024-03-15' } })
      from().focus()
      expect(from()).toHaveFocus()
      expect(screen.getByTestId('mini-month-title')).toHaveTextContent(
        'March 2024'
      )

      // Rotate to a narrow portrait viewport.
      setViewport(500, 900)
      act(() => {
        window.dispatchEvent(new Event('resize'))
      })

      await waitFor(() =>
        expect(screen.getByTestId('range-picker-sheet')).toBeInTheDocument()
      )
      expect(from()).toHaveValue('2024-03-15')
      expect(to()).toHaveValue('2026-10-04')
      expect(screen.getByTestId('mini-month-title')).toHaveTextContent(
        'March 2024'
      )
      await waitFor(() => expect(from()).toHaveFocus())
      expect(applied()).toBe('ytd:1 Jan – 4 Oct 2026')

      // And back again: still the same draft, still focused.
      setViewport(1194, 834)
      act(() => {
        window.dispatchEvent(new Event('resize'))
      })
      await waitFor(() =>
        expect(
          screen.queryByTestId('range-picker-sheet')
        ).not.toBeInTheDocument()
      )
      expect(from()).toHaveValue('2024-03-15')
      await waitFor(() => expect(from()).toHaveFocus())

      // Focus did not jump to the trigger as the old panel went away.
      expect(trigger()).not.toHaveFocus()
    })

    it('restores focus to the trigger on Escape after a switch', async () => {
      setViewport(1194, 834)
      render(<Harness presentation="auto" />)
      open()
      from().focus()
      setViewport(500, 900)
      act(() => {
        window.dispatchEvent(new Event('resize'))
      })
      await waitFor(() =>
        expect(screen.getByTestId('range-picker-sheet')).toBeInTheDocument()
      )
      fireEvent.keyDown(document.activeElement ?? document.body, {
        key: 'Escape'
      })
      await waitFor(() => expect(trigger()).toHaveFocus())
      expect(screen.queryByLabelText('From')).not.toBeInTheDocument()
    })
  })
})
