'use client'

import { ChevronDown } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'

interface DefaultActorDomainSelectorProps {
  domains: string[]
  currentDefault: string | null
}

export function DefaultActorDomainSelector({
  domains,
  currentDefault
}: DefaultActorDomainSelectorProps) {
  const [selectedDomain, setSelectedDomain] = useState<string>(
    currentDefault || domains[0] || ''
  )
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)

  const handleSave = async () => {
    if (!selectedDomain) return

    setIsSaving(true)
    setMessage(null)

    try {
      const response = await fetch('/api/v1/accounts/default-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: selectedDomain })
      })

      if (response.ok) {
        setMessage({ type: 'success', text: 'Default domain updated' })
      } else {
        setMessage({ type: 'error', text: 'Failed to update default domain' })
      }
    } catch {
      setMessage({ type: 'error', text: 'An error occurred' })
    } finally {
      setIsSaving(false)
    }
  }

  const hasChanges = selectedDomain !== currentDefault

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-muted cursor-pointer"
              disabled={isSaving}
            >
              <span>{selectedDomain || 'Select a domain'}</span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[280px]">
            {domains.map((domain) => (
              <DropdownMenuItem
                key={domain}
                onClick={() => setSelectedDomain(domain)}
                disabled={isSaving}
              >
                {domain}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <p className="text-sm text-muted-foreground">
        Available domains: {domains.join(', ')}
      </p>

      {message && (
        <p
          className={`text-sm ${message.type === 'success' ? 'text-green-600' : 'text-destructive'}`}
        >
          {message.text}
        </p>
      )}

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={isSaving || !hasChanges}>
          {isSaving ? 'Saving...' : 'Save domain'}
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        New actors will default to this domain.
      </p>
    </div>
  )
}
