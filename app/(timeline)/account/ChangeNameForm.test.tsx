/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render } from '@testing-library/react'

import { ChangeNameForm } from './ChangeNameForm'

describe('ChangeNameForm', () => {
  it('renders the form with method="post" so the named input is never GET-serialized into the URL', () => {
    // Unlike the other account forms, this input is NAMED (name="name"), so a
    // native (pre-hydration/no-JS) submit would serialize it into the URL under
    // the default GET; method="post" keeps it in the request body.
    const { container } = render(<ChangeNameForm currentName="Ada Lovelace" />)

    const form = container.querySelector('form')
    expect(form).not.toBeNull()
    expect(form).toHaveAttribute('method', 'post')
  })
})
