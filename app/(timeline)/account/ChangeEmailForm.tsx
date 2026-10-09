'use client'

import { FC, useState } from 'react'

import { requestEmailChange } from '@/lib/client'
import { Alert } from '@/lib/components/surface/Alert'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'

interface Props {
  currentEmail: string
}

/**
 * The rows that change the account email, to sit in the same `Frame divided`
 * as the current email: a button to start, then the new address with the
 * button that sends the verification link. The link is a request rather than a
 * save, so it keeps its own verb instead of the `SaveBar`'s "Save".
 */
export const ChangeEmailForm: FC<Props> = ({ currentEmail: _currentEmail }) => {
  const [isChanging, setIsChanging] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setMessage('')
    setIsLoading(true)

    try {
      await requestEmailChange({ newEmail })

      setMessage(
        'Verification email sent! Please check your inbox and click the verification link.'
      )
      setIsChanging(false)
      setNewEmail('')
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'An error occurred. Please try again.'
      )
    } finally {
      setIsLoading(false)
    }
  }

  if (!isChanging) {
    return (
      <>
        <FormRow
          label="Change email address"
          hint="We will send a verification link to the new address."
        >
          {({ describedBy }) => (
            <Button
              type="button"
              variant="outline"
              aria-describedby={describedBy}
              onClick={() => setIsChanging(true)}
            >
              Change email
            </Button>
          )}
        </FormRow>
        {message && <Alert tone="success" flush title={message} />}
      </>
    )
  }

  return (
    // method="post" is defense-in-depth: this input is controlled and has no
    // `name`, so a native (pre-hydration/no-JS) submit sends nothing today, but a
    // method-less <form> defaults to GET — POST keeps the email out of the URL if
    // a `name` attribute is added later.
    <form onSubmit={handleSubmit} method="post" className="divide-y">
      <FormRow
        label="New email address"
        htmlFor="newEmail"
        hint="A verification link will be sent to your new email address. Note: requesting a new email change will invalidate any pending verification."
      >
        {({ describedBy }) => (
          <Input
            type="email"
            id="newEmail"
            aria-describedby={describedBy}
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="new@example.com"
            required
          />
        )}
      </FormRow>

      {error && <Alert flush title={error} />}

      <div className="flex justify-end gap-2 px-4 py-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setIsChanging(false)
            setError('')
            setNewEmail('')
          }}
          disabled={isLoading}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isLoading}>
          {isLoading ? 'Sending…' : 'Send verification email'}
        </Button>
      </div>
    </form>
  )
}
