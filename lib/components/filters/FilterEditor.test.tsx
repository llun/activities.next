/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { ClientFilter } from '@/lib/client'

import { FilterEditor } from './FilterEditor'

const filterWithAction = (filterAction: string) =>
  ({
    id: `f-${filterAction}`,
    title: 'Spoilers',
    context: ['home'],
    filter_action: filterAction,
    expires_at: null,
    keywords: []
  }) as unknown as ClientFilter

describe('FilterEditor', () => {
  // The editor only offers warn/hide cards. A valid card action opens with its
  // own card selected; a filter saved with another action (e.g. `blur`, valid
  // via the API since Mastodon 4.4) opens as warn rather than leaving the
  // radiogroup with nothing checked.
  it.each([
    {
      description: 'keeps warn selected',
      filterAction: 'warn',
      checked: 'warn'
    },
    {
      description: 'keeps hide selected',
      filterAction: 'hide',
      checked: 'hide'
    },
    {
      description: 'falls back to warn for a non-card action (blur)',
      filterAction: 'blur',
      checked: 'warn'
    }
  ])('$description', ({ filterAction, checked }) => {
    render(
      <FilterEditor
        initial={filterWithAction(filterAction)}
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
    expect(warnRadio).toHaveAttribute(
      'aria-checked',
      checked === 'warn' ? 'true' : 'false'
    )
    expect(hideRadio).toHaveAttribute(
      'aria-checked',
      checked === 'hide' ? 'true' : 'false'
    )
  })
})
