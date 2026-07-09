/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { ClientFilter } from '@/lib/client'

import { FilterEditor } from './FilterEditor'

const blurFilter = {
  id: 'f-blur',
  title: 'Spoilers',
  context: ['home'],
  filter_action: 'blur',
  expires_at: null,
  keywords: []
} as unknown as ClientFilter

describe('FilterEditor', () => {
  it('falls back to the warn card when the filter action has no card (e.g. blur)', () => {
    // The editor only offers warn/hide cards. A filter saved with `blur` (valid
    // via the API since Mastodon 4.4) must open with the warn card selected
    // rather than leaving the radiogroup with nothing checked.
    render(
      <FilterEditor
        initial={blurFilter}
        scope="account"
        currentTime={0}
        saving={false}
        error={null}
        onCancel={() => {}}
        onSave={() => {}}
      />
    )

    const warnRadio = screen.getByRole('radio', {
      name: /Hide with a warning/i
    })
    const hideRadio = screen.getByRole('radio', { name: /Hide completely/i })
    expect(warnRadio).toHaveAttribute('aria-checked', 'true')
    expect(hideRadio).toHaveAttribute('aria-checked', 'false')
  })
})
