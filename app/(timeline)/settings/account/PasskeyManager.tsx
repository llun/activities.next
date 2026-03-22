'use client'

import { FC, useEffect, useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { authClient } from '@/lib/services/auth/auth-client'

interface PasskeyItem {
  id: string
  name?: string
  createdAt: Date | string
  deviceType: string
  backedUp: boolean
}

const CANCEL_CODES = new Set(['AUTH_CANCELLED', 'ERROR_CEREMONY_ABORTED'])

const getErrorMessage = (error: {
  code?: string
  message?: unknown
}): string | undefined => {
  if (error.code && CANCEL_CODES.has(error.code)) return undefined
  if (typeof error.message !== 'string') return undefined
  return error.message
}

export const PasskeyManager: FC = () => {
  const [passkeys, setPasskeys] = useState<PasskeyItem[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string>()
  const [success, setSuccess] = useState<string>()

  const loadPasskeys = async () => {
    setLoading(true)
    setError(undefined)
    try {
      const res = await fetch('/api/auth/passkey/list-user-passkeys', {
        method: 'GET',
        credentials: 'include'
      })
      if (res.ok) {
        const data = await res.json()
        setPasskeys(Array.isArray(data) ? data : [])
      } else {
        setError('Failed to load passkeys')
        setPasskeys([])
      }
    } catch {
      setError('Failed to load passkeys')
      setPasskeys([])
    }
    setLoading(false)
  }

  useEffect(() => {
    loadPasskeys()
  }, [])

  const handleAdd = async () => {
    setError(undefined)
    setSuccess(undefined)
    setAdding(true)
    try {
      const result = await authClient.passkey.addPasskey({
        name: newName.trim() || undefined
      })
      if (result?.error) {
        const msg = getErrorMessage(result.error)
        if (msg) setError(msg)
      } else {
        setSuccess('Passkey added successfully')
        setNewName('')
        await loadPasskeys()
      }
    } catch {
      setError('Failed to add passkey. Please try again.')
    }
    setAdding(false)
  }

  const handleDelete = async (id: string) => {
    setError(undefined)
    setSuccess(undefined)
    try {
      const result = await authClient.passkey.deletePasskey({ id })
      if (result?.error) {
        setError(getErrorMessage(result.error) ?? 'Failed to delete passkey')
      } else {
        setSuccess('Passkey removed')
        await loadPasskeys()
      }
    } catch {
      setError('Failed to remove passkey. Please try again.')
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {success && <p className="text-sm text-green-600">{success}</p>}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading passkeys…</p>
      ) : passkeys.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No passkeys registered yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {passkeys.map((pk) => (
            <li key={pk.id} className="flex items-center justify-between gap-2">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">
                  {pk.name || 'Unnamed passkey'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {pk.deviceType === 'multiDevice' ? 'Synced' : 'Device-bound'}
                  {pk.backedUp ? ' · Backed up' : ''}
                  {' · Added '}
                  {new Date(pk.createdAt).toLocaleDateString()}
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => handleDelete(pk.id)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <Input
          placeholder="Passkey name (optional)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="max-w-xs"
        />
        <Button onClick={handleAdd} disabled={adding}>
          {adding ? 'Adding…' : 'Add Passkey'}
        </Button>
      </div>
    </div>
  )
}
