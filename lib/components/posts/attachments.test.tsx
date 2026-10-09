/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { Attachments } from './attachments'
import {
  buildAnnounceStatus,
  buildAttachment,
  buildNoteStatus,
  resetAttachmentTestState
} from './attachments.testUtils'

beforeEach(() => {
  resetAttachmentTestState()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Attachments', () => {
  it('renders nothing for a non-Note status', () => {
    const announce = buildAnnounceStatus(
      buildNoteStatus([buildAttachment({ width: 800, height: 600 })])
    )
    const { container } = render(
      <Attachments status={announce} onMediaSelected={vi.fn()} />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('stops the click from reaching an ancestor click handler', () => {
    const parentOnClick = vi.fn()
    render(
      <div onClick={parentOnClick}>
        <Attachments
          status={buildNoteStatus([
            buildAttachment({ width: 800, height: 600 })
          ])}
          onMediaSelected={vi.fn()}
        />
      </div>
    )

    fireEvent.click(screen.getByRole('button'))

    expect(parentOnClick).not.toHaveBeenCalled()
  })
})
