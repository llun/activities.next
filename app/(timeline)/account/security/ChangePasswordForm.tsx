'use client'

import { FC, useState } from 'react'

import { changeAccountPassword } from '@/lib/client'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { SaveBar } from '@/lib/components/surface/SaveBar'
import { Input } from '@/lib/components/ui/input'

export const ChangePasswordForm: FC = () => {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const dirty = Boolean(currentPassword || newPassword || confirmPassword)

  const edit = (set: (value: string) => void) => (value: string) => {
    set(value)
    setSaved(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaved(false)

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match')
      return
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long')
      return
    }

    setIsLoading(true)

    try {
      await changeAccountPassword({ currentPassword, newPassword })

      setSaved(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
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

  return (
    // method="post" is defense-in-depth: these inputs are controlled and have no
    // `name`, so a native (pre-hydration/no-JS) submit sends nothing today, but a
    // method-less <form> defaults to GET — POST keeps the current/new password out
    // of the URL if a `name` attribute is added later.
    <form onSubmit={handleSubmit} method="post">
      <Frame
        divided
        footer={
          <SaveBar
            submit
            dirty={dirty}
            saving={isLoading}
            saved={saved}
            error={error}
          />
        }
      >
        <FormRow label="Current password" htmlFor="currentPassword">
          <Input
            type="password"
            id="currentPassword"
            value={currentPassword}
            onChange={(e) => edit(setCurrentPassword)(e.target.value)}
            required
          />
        </FormRow>

        <FormRow
          label="New password"
          htmlFor="newPassword"
          hint="Must be at least 8 characters long"
        >
          {({ describedBy }) => (
            <Input
              type="password"
              id="newPassword"
              aria-describedby={describedBy}
              value={newPassword}
              onChange={(e) => edit(setNewPassword)(e.target.value)}
              required
              minLength={8}
            />
          )}
        </FormRow>

        <FormRow label="Confirm new password" htmlFor="confirmPassword">
          <Input
            type="password"
            id="confirmPassword"
            value={confirmPassword}
            onChange={(e) => edit(setConfirmPassword)(e.target.value)}
            required
            minLength={8}
          />
        </FormRow>
      </Frame>
    </form>
  )
}
