'use client'

import { FC, useState } from 'react'

import { requestPasswordReset } from '@/lib/client'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'

export const RequestPasswordResetForm: FC = () => {
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
