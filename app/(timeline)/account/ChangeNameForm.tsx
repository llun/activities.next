'use client'

import { FC, useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'

interface Props {
  currentName: string
}

export const ChangeNameForm: FC<Props> = ({ currentName }) => {
  const [name, setName] = useState(currentName)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setMessage('')
    setIsLoading(true)

    try {
      const response = await fetch('/api/v1/accounts/name', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name })
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to update name')
        return
      }

      setMessage('Name updated successfully!')
    } catch (_err) {
      setError('An error occurred. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="inputName">Name</Label>
        <Input
          name="name"
          type="text"
          id="inputName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your full name"
          maxLength={255}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {message && <p className="text-sm text-green-600">{message}</p>}

      <div className="flex justify-end">
        <Button type="submit" disabled={isLoading}>
          {isLoading ? 'Updating...' : 'Update name'}
        </Button>
      </div>
    </form>
  )
}
