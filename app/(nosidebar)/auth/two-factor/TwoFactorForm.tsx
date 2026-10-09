'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FC, FormEvent, useRef, useState } from 'react'

import { Alert } from '@/lib/components/surface/Alert'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { SegmentedControl } from '@/lib/components/surface/SegmentedControl'
import { Button } from '@/lib/components/ui/button'
import { Checkbox } from '@/lib/components/ui/checkbox'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import { authClient } from '@/lib/services/auth/auth-client'
import { getAuthErrorMessage } from '@/lib/services/auth/getAuthErrorMessage'

interface Props {
  redirectBack: string
}

type VerificationMode = 'totp' | 'backup'

export const TwoFactorForm: FC<Props> = ({ redirectBack }) => {
  const router = useRouter()
  const codeInputRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<VerificationMode>('totp')
  const [code, setCode] = useState('')
  const [trustDevice, setTrustDevice] = useState(false)
  const [error, setError] = useState<string>()
  const [fieldError, setFieldError] = useState<string>()
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(undefined)
    setFieldError(undefined)

    const trimmedCode = code.trim()
    if (!trimmedCode) {
      setFieldError('Verification code is required')
      // Focus moves to the invalid input so its description is read.
      codeInputRef.current?.focus()
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
    <form onSubmit={handleSubmit} method="post" className="space-y-4">
      <SegmentedControl
        aria-label="Verification method"
        className="mx-auto"
        items={[
          { value: 'totp', label: 'Authenticator app' },
          { value: 'backup', label: 'Backup code' }
        ]}
        value={mode}
        onValueChange={(value) =>
          setMode(value === 'backup' ? 'backup' : 'totp')
        }
      />

      <Frame divided>
        <FormRow
          stacked
          label={mode === 'totp' ? 'Verification code' : 'Backup code'}
          htmlFor="twoFactorCode"
        >
          <Input
            ref={codeInputRef}
            id="twoFactorCode"
            autoComplete="one-time-code"
            inputMode={mode === 'totp' ? 'numeric' : 'text'}
            value={code}
            onChange={(event) => {
              setCode(event.target.value)
              setFieldError(undefined)
            }}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? 'twoFactorCode-error' : undefined}
          />
          {fieldError && (
            <p
              id="twoFactorCode-error"
              className="mt-2 text-xs text-destructive-text"
            >
              {fieldError}
            </p>
          )}
        </FormRow>
        <div className="flex items-center gap-2 px-4 py-4">
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
      </Frame>

      {error && <Alert title={error} />}

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? 'Verifying…' : 'Verify and sign in'}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        <Link href="/auth/signin" className="text-primary-text hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  )
}
