'use client'

import Link from 'next/link'
import { FC, useRef, useState } from 'react'

import { resetPassword } from '@/lib/client'
import { Alert } from '@/lib/components/surface/Alert'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'

type Props = {
  initialCode?: string
}

export const ResetPasswordForm: FC<Props> = ({ initialCode }) => {
  const [code, setCode] = useState(initialCode ?? '')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [fieldError, setFieldError] = useState<{
    field: 'code' | 'newPassword' | 'confirmPassword'
    message: string
  }>()
  const [message, setMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const codeInputRef = useRef<HTMLInputElement>(null)
  const newPasswordInputRef = useRef<HTMLInputElement>(null)
  const confirmPasswordInputRef = useRef<HTMLInputElement>(null)

  const clearFieldError = (field: NonNullable<typeof fieldError>['field']) =>
    setFieldError((current) => (current?.field === field ? undefined : current))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isLoading || isSuccess) {
      return
    }

    setError('')
    setFieldError(undefined)
    setMessage('')

    // Checked in field order, so the first invalid input gets the message and
    // focus (moving focus there makes a screen reader read its description).
    if (!code.trim()) {
      setFieldError({ field: 'code', message: 'Reset code is required' })
      codeInputRef.current?.focus()
      return
    }

    if (newPassword.length < 8) {
      setFieldError({
        field: 'newPassword',
        message: 'Password must be at least 8 characters long'
      })
      newPasswordInputRef.current?.focus()
      return
    }

    if (newPassword !== confirmPassword) {
      setFieldError({
        field: 'confirmPassword',
        message: 'Passwords do not match'
      })
      confirmPasswordInputRef.current?.focus()
      return
    }

    setIsLoading(true)

    try {
      const data = await resetPassword({ code, newPassword })

      setIsSuccess(true)
      setMessage(data.message || 'Password reset successfully')
      setNewPassword('')
      setConfirmPassword('')
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
    // method="post" is defense-in-depth. These inputs are controlled and have no
    // `name`, so a native (pre-hydration/no-JS) submit sends nothing today, but a
    // method-less <form> defaults to GET — POST keeps the reset code and new
    // password out of the URL if a `name` attribute is added later.
    <form onSubmit={handleSubmit} method="post" className="space-y-4">
      <Frame divided>
        <FormRow stacked label="Reset code" htmlFor="code">
          <Input
            ref={codeInputRef}
            id="code"
            type="text"
            value={code}
            onChange={(e) => {
              setCode(e.target.value)
              clearFieldError('code')
            }}
            aria-invalid={fieldError?.field === 'code' ? true : undefined}
            aria-describedby={
              fieldError?.field === 'code' ? 'code-error' : undefined
            }
            required
            disabled={isSuccess}
          />
          {fieldError?.field === 'code' && (
            <p id="code-error" className="mt-2 text-xs text-destructive-text">
              {fieldError.message}
            </p>
          )}
        </FormRow>
        <FormRow stacked label="New password" htmlFor="newPassword">
          <Input
            ref={newPasswordInputRef}
            id="newPassword"
            type="password"
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value)
              clearFieldError('newPassword')
            }}
            aria-invalid={
              fieldError?.field === 'newPassword' ? true : undefined
            }
            aria-describedby={
              fieldError?.field === 'newPassword'
                ? 'newPassword-error'
                : undefined
            }
            required
            minLength={8}
            disabled={isSuccess}
          />
          {fieldError?.field === 'newPassword' && (
            <p
              id="newPassword-error"
              className="mt-2 text-xs text-destructive-text"
            >
              {fieldError.message}
            </p>
          )}
        </FormRow>
        <FormRow stacked label="Confirm new password" htmlFor="confirmPassword">
          <Input
            ref={confirmPasswordInputRef}
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value)
              clearFieldError('confirmPassword')
            }}
            aria-invalid={
              fieldError?.field === 'confirmPassword' ? true : undefined
            }
            aria-describedby={
              fieldError?.field === 'confirmPassword'
                ? 'confirmPassword-error'
                : undefined
            }
            required
            disabled={isSuccess}
          />
          {fieldError?.field === 'confirmPassword' && (
            <p
              id="confirmPassword-error"
              className="mt-2 text-xs text-destructive-text"
            >
              {fieldError.message}
            </p>
          )}
        </FormRow>
      </Frame>

      {error && <Alert title={error} />}
      {message && <Alert tone="success" title={message} />}

      {isSuccess ? (
        <Button asChild type="button" className="w-full">
          <Link href="/auth/signin">Continue to sign in</Link>
        </Button>
      ) : (
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? 'Resetting…' : 'Reset password'}
        </Button>
      )}
    </form>
  )
}
