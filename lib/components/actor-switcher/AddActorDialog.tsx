'use client'

import { useEffect, useState } from 'react'

import { createActor, getActorDomains, switchActor } from '@/lib/client'
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
import { RadioGroup, RadioGroupItem } from '@/lib/components/ui/radio-group'

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
  const [selectedDomain, setSelectedDomain] = useState(domain)
  const [availableDomains, setAvailableDomains] = useState<string[]>([domain])
  const [hostDomain, setHostDomain] = useState(domain)
  const [domainsLoaded, setDomainsLoaded] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || domainsLoaded) {
      return
    }

    const controller = new AbortController()
    let isCancelled = false

    const fetchDomains = async () => {
      try {
        const data = await getActorDomains({ signal: controller.signal })
        if (isCancelled) return

        if (data.domains && Array.isArray(data.domains) && data.host) {
          setAvailableDomains(data.domains)
          setHostDomain(data.host)
          // Set the default domain to host if available
          if (data.domains.includes(data.host)) {
            setSelectedDomain(data.host)
          } else if (data.domains.length > 0) {
            setSelectedDomain(data.domains[0])
          }
        }
        setDomainsLoaded(true)
      } catch (err) {
        if (isCancelled || controller.signal.aborted) {
          return
        }
        setError(err instanceof Error ? err.message : 'Failed to load domains')
      }
    }

    fetchDomains()

    return () => {
      isCancelled = true
      controller.abort()
    }
  }, [open, domainsLoaded])

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
      const data = await createActor({
        username: username.trim(),
        domain: selectedDomain
      })

      // Switch to the new actor
      await switchActor({ actorId: data.id })

      setUsername('')
      onSuccess()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'An error occurred while creating the actor'
      )
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!open) {
      setUsername('')
      setError(null)
    }
  }, [open])

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
            Create a new identity. You can switch between actors at any time.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            {availableDomains.length > 1 && (
              <div className="space-y-2">
                <Label>Domain</Label>
                <RadioGroup
                  value={selectedDomain}
                  onValueChange={setSelectedDomain}
                  disabled={isLoading}
                >
                  {availableDomains.map((domain) => (
                    <div key={domain} className="flex items-center space-x-2">
                      <RadioGroupItem value={domain} id={domain} />
                      <Label htmlFor={domain} className="font-normal">
                        {domain}
                        {domain === hostDomain && (
                          <span className="text-xs text-muted-foreground ml-1">
                            (main)
                          </span>
                        )}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
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
