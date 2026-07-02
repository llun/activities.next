'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FC, FormEvent, useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import { Checkbox } from '@/lib/components/ui/checkbox'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import { authClient } from '@/lib/services/auth/auth-client'
import { getAuthErrorMessage } from '@/lib/services/auth/getAuthErrorMessage'
import { cn } from '@/lib/utils'

interface Props {
  redirectBack: string
}

type VerificationMode = 'totp' | 'backup'

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
        setError(getAuthErrorMessage(result.error, 'Verification failed'))
        setLoading(false)
        return
      }

      setLoading(false)
      router.push(redirectBack)
    } catch {
      setError('Verification failed')
      setLoading(false)
    }
  }

  return (
    // method="post" is defense-in-depth. The code input is controlled and has no
    // `name`, so a native (pre-hydration/no-JS) submit sends nothing today, but a
    // method-less <form> defaults to GET — POST keeps the verification/backup code
    // out of the URL if a `name` attribute is added later.
    <form onSubmit={handleSubmit} method="post" className="space-y-5">
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

      <div className="flex items-center gap-2">
        <Checkbox
          id="trustDevice"
          checked={trustDevice}
          onChange={(event) => setTrustDevice(event.target.checked)}
        />
        <Label
          htmlFor="trustDevice"
          className="text-sm font-normal text-muted-foreground"
        >
          Trust this device for 30 days
        </Label>
      </div>

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
