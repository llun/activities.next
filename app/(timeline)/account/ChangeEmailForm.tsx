'use client'

import { FC, ReactNode, useState } from 'react'

import { requestEmailChange } from '@/lib/client'
import { Alert } from '@/lib/components/surface/Alert'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'

interface Props {
  currentEmail: string
  /**
   * Whether the account has a password. A password account must prove it
   * before the address can move; a passkey- or OAuth-only account has none to
   * prove and keeps the session-only request.
   */
  requiresPassword: boolean
  /** Rows shown above the change rows in the same box, such as the current email. */
  children?: ReactNode
}

/**
 * The account email's box: a `Frame form` with the `children` rows (the current
 * email) and the change rows: a button to start, then the new address with the
 * button that sends the verification link in the Frame's footer. The link is a
 * request rather than a save, so it keeps its own verb instead of the
 * `SaveBar`'s "Save".
 */
export const ChangeEmailForm: FC<Props> = ({
  currentEmail: _currentEmail,
  requiresPassword,
  children
}) => {
  const [isChanging, setIsChanging] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setMessage('')
    setIsLoading(true)

    try {
      await requestEmailChange({
        newEmail,
        ...(requiresPassword ? { currentPassword } : {})
      })

      setMessage(
        'Verification email sent! Please check your inbox and click the verification link.'
      )
      setIsChanging(false)
      setNewEmail('')
      setCurrentPassword('')
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
      <div className="space-y-3">
        {message && <Alert tone="success" title={message} />}
        <Frame form>
          {children}
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
        </Frame>
      </div>
    )
  }

  return (
    // method="post" is defense-in-depth: this input is controlled and has no
    // `name`, so a native (pre-hydration/no-JS) submit sends nothing today, but a
    // method-less <form> defaults to GET — POST keeps the email out of the URL if
    // a `name` attribute is added later.
    <form onSubmit={handleSubmit} method="post" className="space-y-3">
      {error && <Alert title={error} />}
      <Frame
        form
        footer={
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIsChanging(false)
                setError('')
                setNewEmail('')
                setCurrentPassword('')
              }}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Sending…' : 'Send verification email'}
            </Button>
          </div>
        }
      >
        {children}
        {requiresPassword && (
          <FormRow
            label="Current password"
            htmlFor="currentPassword"
            hint="Confirms it is you before the address can change."
          >
            <Input
              type="password"
              id="currentPassword"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </FormRow>
        )}
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
      </Frame>
    </form>
  )
}
