'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FC, FormEvent, useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import { authClient } from '@/lib/services/auth/auth-client'
import { cn } from '@/lib/utils'

interface Props {
  redirectBack: string
}

type VerificationMode = 'totp' | 'backup'

const getErrorMessage = (
  error: { message?: unknown } | null | undefined,
  fallback: string
): string => {
  return typeof error?.message === 'string' ? error.message : fallback
}

export const TwoFactorForm: FC<Props> = ({ redirectBack }) => {
  const router = useRouter()
  const [mode, setMode] = useState<VerificationMode>('totp')
  const [code, setCode] = useState('')
  const [trustDevice, setTrustDevice] = useState(false)
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(undefined)

    const trimmedCode = code.trim()
    if (!trimmedCode) {
      setError('Verification code is required')
      return
    }

    setLoading(true)
    try {
      const result =
        mode === 'totp'
          ? await authClient.twoFactor.verifyTotp({
              code: trimmedCode,
              trustDevice
            })
          : await authClient.twoFactor.verifyBackupCode({
              code: trimmedCode,
              trustDevice
            })

      if (result.error) {
        setError(getErrorMessage(result.error, 'Verification failed'))
        setLoading(false)
        return
      }

      router.push(redirectBack)
      router.refresh()
    } catch {
      setError('Verification failed')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-2 rounded-md border bg-muted p-1">
        <button
          type="button"
          className={cn(
            'rounded-sm px-3 py-2 text-sm font-medium transition-colors',
            mode === 'totp'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
          onClick={() => setMode('totp')}
        >
          Authenticator app
        </button>
        <button
          type="button"
          className={cn(
            'rounded-sm px-3 py-2 text-sm font-medium transition-colors',
            mode === 'backup'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
          onClick={() => setMode('backup')}
        >
          Backup code
        </button>
      </div>

      <div className="space-y-2">
        <Label htmlFor="twoFactorCode">
          {mode === 'totp' ? 'Verification code' : 'Backup code'}
        </Label>
        <Input
          id="twoFactorCode"
          autoComplete="one-time-code"
          inputMode={mode === 'totp' ? 'numeric' : 'text'}
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={trustDevice}
          onChange={(event) => setTrustDevice(event.target.checked)}
          className="size-4 rounded border-input"
        />
        Trust this device for 30 days
      </label>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? 'Verifying...' : 'Verify and sign in'}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        <Link href="/auth/signin" className="text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  )
}
