'use client'

import { FC, useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import { parseFetchResponseData } from '@/lib/utils/parseFetchResponseData'

export const RequestPasswordResetForm: FC = () => {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setMessage('')
    setIsLoading(true)

    try {
      const response = await fetch('/api/v1/accounts/password/reset/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email })
      })
      const data = await parseFetchResponseData(response)
      const responseError =
        typeof data.error === 'string'
          ? data.error
          : 'Failed to request password reset'
      const responseMessage =
        typeof data.message === 'string'
          ? data.message
          : 'If an account exists for that email, a password reset link has been sent.'
      if (!response.ok) {
        setError(responseError)
        return
      }

      setMessage(responseMessage)
    } catch (_error) {
      setError('An unexpected error occurred. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    // method="post" is defense-in-depth. The email input is controlled and has
    // no `name`, so a native (pre-hydration/no-JS) submit sends nothing today, but
    // a method-less <form> defaults to GET — POST guards against the email
    // reaching the URL if a `name` attribute is added later.
    <form onSubmit={handleSubmit} method="post" className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}

      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? 'Sending...' : 'Send reset link'}
      </Button>
    </form>
  )
}
