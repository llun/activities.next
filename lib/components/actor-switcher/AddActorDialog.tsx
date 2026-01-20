'use client'

import { useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/lib/components/ui/dialog'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'

interface AddActorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  domain: string
  onSuccess: () => void
}

export function AddActorDialog({
  open,
  onOpenChange,
  domain,
  onSuccess
}: AddActorDialogProps) {
  const [username, setUsername] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!username.trim()) {
      setError('Username is required')
      return
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      setError('Username can only contain letters, numbers, and underscores')
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch('/api/v1/actors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), domain })
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to create actor')
        return
      }

      // Switch to the new actor
      await fetch('/api/v1/actors/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId: data.id })
      })

      setUsername('')
      onSuccess()
    } catch {
      setError('An error occurred while creating the actor')
    } finally {
      setIsLoading(false)
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setUsername('')
      setError(null)
    }
    onOpenChange(newOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add another actor</DialogTitle>
          <DialogDescription>
            Create a new identity on {domain}. You can switch between actors at
            any time.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                placeholder="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isLoading}
              />
              <p className="text-sm text-muted-foreground">
                Your new handle will be @{username || 'username'}@{domain}
              </p>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading || !username.trim()}>
              {isLoading ? 'Creating...' : 'Create actor'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
