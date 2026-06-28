'use client'

import { Check, Fingerprint, Globe, Plus } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { FC, useCallback, useEffect, useState } from 'react'

import { type Passkey, getPasskeys } from '@/lib/client'
import { Badge } from '@/lib/components/ui/badge'
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
import { authClient } from '@/lib/services/auth/auth-client'
import type { ServedDomain } from '@/lib/services/auth/servedDomains'

const RESUME_PARAM = 'add-passkey'
const CANCEL_CODES = new Set(['AUTH_CANCELLED', 'ERROR_CEREMONY_ABORTED'])

const getErrorMessage = (error: {
  code?: string
  message?: unknown
}): string | undefined => {
  if (error.code && CANCEL_CODES.has(error.code)) return undefined
  if (typeof error.message !== 'string') return undefined
  return error.message
}

const formatAddedDate = (value: string): string => {
  // The API returns ISO-8601, but normalize defensively: a zone-less
  // `YYYY-MM-DD HH:MM:SS` string parses as local time (and Safari may reject it),
  // so coerce it to UTC before parsing. Use the browser locale, not a pinned one.
  const normalized =
    value.includes('T') || value.endsWith('Z')
      ? value
      : `${value.replace(' ', 'T')}Z`
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: '2-digit',
    year: 'numeric'
  })
}

interface PasskeyManagerProps {
  // Domains this instance serves; a passkey is bound to exactly one of them.
  domains: ServedDomain[]
  // The domain the user is currently viewing the settings on.
  currentDomain: string
  // The account's local username, shown as `handle@domain` in the chooser.
  handlePrefix?: string
}

const DomainPill: FC<{ domain: string }> = ({ domain }) => (
  <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium">
    <Globe className="size-3" />
    {domain}
  </span>
)

const PasskeyRow: FC<{
  passkey: Passkey
  showDomain: boolean
  isPrimary: boolean
  onRemove: (id: string) => void
}> = ({ passkey, showDomain, isPrimary, onRemove }) => {
  const added = formatAddedDate(passkey.createdAt)
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
      <div className="flex min-w-0 items-center gap-3">
        <Fingerprint className="text-muted-foreground size-5 shrink-0" />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {passkey.name || 'Unnamed passkey'}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {showDomain && <DomainPill domain={passkey.domain} />}
            {showDomain && isPrimary && <Badge tone="gray">Primary</Badge>}
            {added && (
              <span className="text-muted-foreground text-xs">
                Added {added}
              </span>
            )}
          </div>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={() => onRemove(passkey.id)}>
        Remove
      </Button>
    </div>
  )
}

const DomainOption: FC<{
  domain: ServedDomain
  handlePrefix: string
  selected: boolean
  onSelect: (domain: string) => void
}> = ({ domain, handlePrefix, selected, onSelect }) => (
  <button
    type="button"
    role="radio"
    aria-checked={selected}
    onClick={() => onSelect(domain.domain)}
    className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
      selected ? 'border-primary bg-primary/5 ring-primary ring-1' : ''
    }`}
  >
    <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md">
      <Globe className="size-[18px]" />
    </span>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className="truncate">{domain.domain}</span>
        {domain.primary && <Badge tone="gray">Primary</Badge>}
      </div>
      <div className="text-muted-foreground truncate text-xs">
        {handlePrefix}@{domain.domain}
      </div>
    </div>
    <span
      className={`shrink-0 ${selected ? 'text-primary' : 'text-muted-foreground/40'}`}
    >
      {selected ? (
        <Check className="size-[18px]" />
      ) : (
        <span className="inline-block size-[18px] rounded-full border" />
      )}
    </span>
  </button>
)

export const PasskeyManager: FC<PasskeyManagerProps> = ({
  domains,
  currentDomain,
  handlePrefix = 'you'
}) => {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [passkeys, setPasskeys] = useState<Passkey[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedDomain, setSelectedDomain] = useState(currentDomain)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string>()
  const [success, setSuccess] = useState<string>()

  const multiDomain = domains.length > 1
  const primaryDomains = new Set(
    domains.filter((d) => d.primary).map((d) => d.domain)
  )

  const loadPasskeys = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      setPasskeys(await getPasskeys())
    } catch {
      setError('Failed to load passkeys')
      setPasskeys([])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadPasskeys()
  }, [loadPasskeys])

  const openDialog = useCallback((domain: string) => {
    setError(undefined)
    setSuccess(undefined)
    setNewName('')
    setSelectedDomain(domain)
    setDialogOpen(true)
  }, [])

  // Clear the create error when the dialog closes so a dismissed failure does
  // not re-surface on the settings page (where it sat behind the overlay).
  const handleDialogOpenChange = (open: boolean) => {
    setDialogOpen(open)
    if (!open) setError(undefined)
  }

  // Switching the target domain invalidates an error tied to the previous one.
  const handleSelectDomain = (domain: string) => {
    setError(undefined)
    setSelectedDomain(domain)
  }

  // Resume an add-passkey flow that started on another domain: when this domain
  // matches the `add-passkey` query param, open the dialog preselected to it,
  // then strip the param so a refresh doesn't reopen the dialog.
  useEffect(() => {
    const resume = searchParams.get(RESUME_PARAM)
    if (
      resume &&
      resume === currentDomain &&
      domains.some((d) => d.domain === resume)
    ) {
      openDialog(resume)
      router.replace('/account/security')
    }
  }, [searchParams, currentDomain, domains, openDialog, router])

  const handleCreate = async () => {
    // Passkeys are bound to the origin that creates them, so a credential for
    // another domain must be minted on that domain. Send the user there and
    // resume the dialog on arrival. Preserve a non-standard port (served domains
    // share this server's port) so the redirect resolves in local/dev setups
    // instead of falling back to 80/443.
    if (selectedDomain !== currentDomain) {
      const port = window.location.port ? `:${window.location.port}` : ''
      window.location.href = `${window.location.protocol}//${selectedDomain}${port}/account/security?${RESUME_PARAM}=${encodeURIComponent(selectedDomain)}`
      return
    }

    setError(undefined)
    setSuccess(undefined)
    setAdding(true)
    try {
      const result = await authClient.passkey.addPasskey({
        name: newName.trim() || undefined
      })
      if (result?.error) {
        const message = getErrorMessage(result.error)
        if (message) setError(message)
      } else {
        setSuccess('Passkey added successfully')
        setDialogOpen(false)
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

  const createDisabled = adding && selectedDomain === currentDomain

  return (
    <div className="space-y-4">
      {error && <p className="text-destructive text-sm">{error}</p>}
      {success && <p className="text-sm text-green-600">{success}</p>}

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading passkeys…</p>
      ) : passkeys.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No passkeys registered yet.
        </p>
      ) : (
        <div className="space-y-2">
          {passkeys.map((passkey) => (
            <PasskeyRow
              key={passkey.id}
              passkey={passkey}
              showDomain={multiDomain}
              isPrimary={primaryDomains.has(passkey.domain)}
              onRemove={handleDelete}
            />
          ))}
        </div>
      )}

      <Button
        variant="outline"
        size="sm"
        onClick={() => openDialog(currentDomain)}
      >
        <Plus className="size-4" />
        Add passkey
      </Button>

      <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="flex-row items-start gap-3 space-y-0 text-left">
            <span className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl">
              <Fingerprint className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base">Add a passkey</DialogTitle>
              <DialogDescription>
                {multiDomain
                  ? 'Choose the domain this passkey will sign you in to, then follow your browser’s prompt.'
                  : 'Follow your browser’s prompt to create a passkey for this site.'}
              </DialogDescription>
            </div>
          </DialogHeader>

          {multiDomain && (
            <div className="space-y-2">
              <Label id="passkey-domain-label">Domain</Label>
              <div
                role="radiogroup"
                aria-labelledby="passkey-domain-label"
                className="space-y-2"
              >
                {domains.map((domain) => (
                  <DomainOption
                    key={domain.domain}
                    domain={domain}
                    handlePrefix={handlePrefix}
                    selected={selectedDomain === domain.domain}
                    onSelect={handleSelectDomain}
                  />
                ))}
              </div>
              <p className="text-muted-foreground text-[0.8rem]">
                Passkeys only work on the domain they were created for.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="passkey-name">Passkey name</Label>
            <Input
              id="passkey-name"
              value={newName}
              placeholder="e.g. iPhone 15 · Face ID"
              onChange={(e) => setNewName(e.target.value)}
            />
            <p className="text-muted-foreground text-[0.8rem]">
              A label to help you recognize this device later.
            </p>
          </div>

          {/* Surface failures inside the dialog — the page-level message below
              sits behind the modal overlay while the dialog is open. */}
          {error && <p className="text-destructive text-sm">{error}</p>}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleDialogOpenChange(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createDisabled}>
              <Fingerprint className="size-4" />
              {selectedDomain !== currentDomain
                ? `Continue on ${selectedDomain}`
                : adding
                  ? 'Creating…'
                  : 'Create passkey'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
