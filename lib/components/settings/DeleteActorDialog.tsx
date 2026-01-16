'use client'

import { AlertTriangle } from 'lucide-react'
import { useRouter } from 'next/navigation'
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
import { Label } from '@/lib/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/lib/components/ui/radio-group'

interface DeleteActorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  actorId: string
  actorUsername: string
  actorDomain: string
}

export function DeleteActorDialog({
  open,
  onOpenChange,
  actorId,
  actorUsername,
  actorDomain
}: DeleteActorDialogProps) {
  const router = useRouter()
  const [delayOption, setDelayOption] = useState<'immediate' | 'delayed'>(
    'delayed'
  )
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDelete = async () => {
    setError(null)
    setIsLoading(true)

    try {
      const response = await fetch('/api/v1/actors/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actorId,
          delayDays: delayOption === 'delayed' ? 3 : 0
        })
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to delete actor')
        return
      }

      onOpenChange(false)
      router.refresh()
    } catch {
      setError('An error occurred while deleting the actor')
    } finally {
      setIsLoading(false)
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setDelayOption('delayed')
      setError(null)
    }
    onOpenChange(newOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Delete Actor
          </DialogTitle>
          <DialogDescription>
            You are about to delete{' '}
            <strong>
              @{actorUsername}@{actorDomain}
            </strong>
            . This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
            <p className="text-sm font-medium text-destructive">
              Warning: All data will be permanently deleted
            </p>
            <ul className="mt-2 list-inside list-disc text-sm text-muted-foreground">
              <li>All posts and media</li>
              <li>All followers and following relationships</li>
              <li>All likes and notifications</li>
              <li>Profile information</li>
            </ul>
          </div>

          <div className="space-y-3">
            <Label>When should this actor be deleted?</Label>
            <RadioGroup
              value={delayOption}
              onValueChange={(value) =>
                setDelayOption(value as 'immediate' | 'delayed')
              }
              className="space-y-2"
            >
              <div className="flex items-start space-x-3 rounded-lg border p-3">
                <RadioGroupItem value="delayed" id="delayed" className="mt-1" />
                <div className="space-y-1">
                  <Label htmlFor="delayed" className="font-medium">
                    Delete after 3 days (Recommended)
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    You can cancel the deletion within 3 days if you change your
                    mind. The actor will be disabled immediately.
                  </p>
                </div>
              </div>
              <div className="flex items-start space-x-3 rounded-lg border p-3">
                <RadioGroupItem
                  value="immediate"
                  id="immediate"
                  className="mt-1"
                />
                <div className="space-y-1">
                  <Label htmlFor="immediate" className="font-medium">
                    Delete immediately
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    The actor and all data will be deleted right away. This
                    cannot be undone.
                  </p>
                </div>
              </div>
            </RadioGroup>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={isLoading}
          >
            {isLoading
              ? 'Deleting...'
              : delayOption === 'delayed'
                ? 'Schedule Deletion'
                : 'Delete Now'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
