'use client'

import { FC, useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'

interface Props {
  currentEmail: string
}

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
      const response = await fetch('/api/v1/accounts/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ newEmail })
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to request email change')
        return
      }

      setMessage(
        'Verification email sent! Please check your inbox and click the verification link.'
      )
      setIsChanging(false)
      setNewEmail('')
    } catch (_err) {
      setError('An error occurred. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  if (!isChanging) {
    return (
      <div>
        <Button
          type="button"
          variant="outline"
          onClick={() => setIsChanging(true)}
        >
          Change Email
        </Button>
        {message && <p className="mt-2 text-sm text-green-600">{message}</p>}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="newEmail">New Email Address</Label>
        <Input
          type="email"
          id="newEmail"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          placeholder="new@example.com"
          required
        />
        <p className="text-xs text-muted-foreground">
          A verification link will be sent to your new email address. Note:
          requesting a new email change will invalidate any pending
          verification.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={isLoading}>
          {isLoading ? 'Sending...' : 'Send Verification Email'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setIsChanging(false)
            setNewEmail('')
            setError('')
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
