'use client'

import Link from 'next/link'
import { FC, useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import { parseFetchResponseData } from '@/lib/utils/parseFetchResponseData'

type Props = {
  initialCode?: string
}

export const ResetPasswordForm: FC<Props> = ({ initialCode }) => {
  const [code, setCode] = useState(initialCode ?? '')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setMessage('')

    if (!code.trim()) {
      setError('Reset code is required')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long')
      return
    }

    setIsLoading(true)

    try {
      const response = await fetch('/api/v1/accounts/password/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ code, newPassword })
      })

      const data = await parseFetchResponseData(response)
      const responseError =
        typeof data.error === 'string' ? data.error : 'Failed to reset password'
      const responseMessage =
        typeof data.message === 'string'
          ? data.message
          : 'Password reset successfully'

      if (!response.ok) {
        setError(responseError)
        return
      }

      setIsSuccess(true)
      setMessage(responseMessage)
      setNewPassword('')
      setConfirmPassword('')
    } catch (_error) {
      setError('An unexpected error occurred. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="code">Reset Code</Label>
        <Input
          id="code"
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          disabled={isSuccess}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="newPassword">New Password</Label>
        <Input
          id="newPassword"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={8}
          disabled={isSuccess}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Confirm New Password</Label>
        <Input
          id="confirmPassword"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          disabled={isSuccess}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}

      {isSuccess ? (
        <Button asChild type="button" className="w-full">
          <Link href="/auth/signin">Continue to Sign In</Link>
        </Button>
      ) : (
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? 'Resetting...' : 'Reset password'}
        </Button>
      )}
    </form>
  )
}
