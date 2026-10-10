'use client'

import { FC, ReactNode, useState } from 'react'

import { AuthCardActions, AuthCardBody } from '@/app/(nosidebar)/AuthCard'
import { requestPasswordReset } from '@/lib/client'
import { Alert } from '@/lib/components/surface/Alert'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'

interface Props {
  /** The "Remembered your password?" line, in the card's action band. */
  footer?: ReactNode
}

export const RequestPasswordResetForm: FC<Props> = ({ footer }) => {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isLoading) {
      return
    }

    setError('')
    setMessage('')
    setIsLoading(true)

    try {
      const data = await requestPasswordReset({ email })
      setMessage(
        data.message ||
          'If an account exists for that email, a password reset link has been sent.'
      )
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'An unexpected error occurred. Please try again.'
      )
    } finally {
      setIsLoading(false)
    }
  }

  return (
    // method="post" is defense-in-depth. The email input is controlled and has
    // no `name`, so a native (pre-hydration/no-JS) submit sends nothing today, but
    // a method-less <form> defaults to GET — POST guards against the email
    // reaching the URL if a `name` attribute is added later.
    <form onSubmit={handleSubmit} method="post">
      <AuthCardBody>
        <FormRow stacked className="p-0" label="Email" htmlFor="email">
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </FormRow>

        {error && <Alert title={error} />}
        {message && (
          <Alert tone="success" title="Check your email">
            {message}
          </Alert>
        )}
      </AuthCardBody>

      <AuthCardActions>
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? 'Sending…' : 'Send reset link'}
        </Button>
        {footer}
      </AuthCardActions>
    </form>
  )
}
