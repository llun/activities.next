/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { ProfileTabStrip } from './ProfileTabStrip'

describe('ProfileTabStrip', () => {
  it('draws one item per tab with its label and marks the value as chosen', () => {
    render(
      <ProfileTabStrip
        tabs={['posts', 'replies', 'media']}
        value="replies"
        onValueChange={() => {}}
      />
    )

    expect(
      screen.getAllByRole('radio').map((radio) => radio.textContent)
    ).toEqual(['Posts', 'Replies', 'Media'])
    expect(screen.getByRole('radio', { name: 'Replies' })).toBeChecked()
  })

  it('reports the chosen tab', () => {
    const onValueChange = vi.fn()
    render(
      <ProfileTabStrip
        tabs={['posts', 'media']}
        value="posts"
        onValueChange={onValueChange}
      />
    )

    fireEvent.click(screen.getByRole('radio', { name: 'Media' }))

    expect(onValueChange).toHaveBeenCalledWith('media')
  })
})
