'use client'

import { useEffect, useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/lib/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'

interface AddActorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  domains: string[]
  defaultDomain?: string | null
  currentDomain?: string | null
  onSuccess: () => void
}

export function AddActorDialog({
  open,
  onOpenChange,
  domains,
  defaultDomain,
  currentDomain,
  onSuccess
}: AddActorDialogProps) {
  const [username, setUsername] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const availableDomains = domains.length
    ? domains
    : currentDomain
      ? [currentDomain]
      : []
  const initialDomain =
    defaultDomain ?? currentDomain ?? availableDomains[0] ?? ''
  const [selectedDomain, setSelectedDomain] = useState(initialDomain)

  useEffect(() => {
    if (open) {
      setSelectedDomain(initialDomain)
    }
  }, [initialDomain, open])

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

    if (!selectedDomain) {
      setError('Domain is required')
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch('/api/v1/actors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          domain: selectedDomain
        })
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
            Create a new identity on {selectedDomain || 'your domain'}. You can
            switch between actors at any time.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            {availableDomains.length > 1 && (
              <div className="space-y-2">
                <Label>Domain</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors hover:bg-muted"
                      disabled={isLoading}
                    >
                      <span>{selectedDomain}</span>
                      <span className="text-muted-foreground">▼</span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-[240px]">
                    {availableDomains.map((domainOption) => (
                      <DropdownMenuItem
                        key={domainOption}
                        onClick={() => setSelectedDomain(domainOption)}
                        disabled={isLoading}
                      >
                        {domainOption}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
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
                Your new handle will be @{username || 'username'}@
                {selectedDomain}
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
