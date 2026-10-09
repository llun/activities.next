'use client'

import { Check, Copy, RefreshCw, ShieldCheck, ShieldOff } from 'lucide-react'
import { useRouter } from 'next/navigation'
import QRCode from 'qrcode'
import { FC, useEffect, useState } from 'react'

import { Alert } from '@/lib/components/surface/Alert'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { authClient } from '@/lib/services/auth/auth-client'
import { getAuthErrorMessage } from '@/lib/services/auth/getAuthErrorMessage'

interface Props {
  enabled: boolean
  serviceName: string
}

interface SetupState {
  totpURI: string
  backupCodes: string[]
  secret: string
}

const getSecretFromTotpURI = (totpURI: string): string => {
  try {
    return new URL(totpURI).searchParams.get('secret') ?? ''
  } catch {
    return ''
  }
}

export const TwoFactorManager: FC<Props> = ({
  enabled: initialEnabled,
  serviceName
}) => {
  const router = useRouter()
  const [enabled, setEnabled] = useState(initialEnabled)
  const [setup, setSetup] = useState<SetupState>()
  const [qrCodeUrl, setQrCodeUrl] = useState<string>()
  const [password, setPassword] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [disablePassword, setDisablePassword] = useState('')
  const [backupPassword, setBackupPassword] = useState('')
  const [newBackupCodes, setNewBackupCodes] = useState<string[]>([])
  const [loadingAction, setLoadingAction] = useState<
    'setup' | 'verify' | 'disable' | 'backup' | undefined
  >()
  const [error, setError] = useState<string>()
  const [success, setSuccess] = useState<string>()

  useEffect(() => {
    setEnabled(initialEnabled)
  }, [initialEnabled])

  useEffect(() => {
    if (!setup?.totpURI) {
      setQrCodeUrl(undefined)
      return
    }

    let active = true
    QRCode.toDataURL(setup.totpURI, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 192
    })
      .then((url) => {
        if (active) setQrCodeUrl(url)
      })
      .catch(() => {
        if (active) setQrCodeUrl(undefined)
      })

    return () => {
      active = false
    }
  }, [setup?.totpURI])

  const copyText = async (text: string, label: string) => {
    setError(undefined)
    setSuccess(undefined)
    try {
      await navigator.clipboard.writeText(text)
      setSuccess(`${label} copied`)
    } catch {
      setError(`Failed to copy ${label.toLowerCase()}`)
    }
  }

  const handleStartSetup = async () => {
    setError(undefined)
    setSuccess(undefined)
    setNewBackupCodes([])

    if (!password) {
      setError('Current password is required')
      return
    }

    setLoadingAction('setup')
    try {
      const result = await authClient.twoFactor.enable({
        password,
        method: 'totp',
        issuer: serviceName
      })
      if (result.error) {
        setError(getAuthErrorMessage(result.error, 'Failed to start setup'))
        return
      }
      const data = result.data
      if (!data || data.method !== 'totp' || !data.totpURI) {
        setError('Failed to start setup')
        return
      }

      setSetup({
        totpURI: data.totpURI,
        backupCodes: data.backupCodes,
        secret: getSecretFromTotpURI(data.totpURI)
      })
      setPassword('')
      setSuccess('Scan the code and enter a verification code to finish setup')
    } catch {
      setError('Failed to start setup')
    } finally {
      setLoadingAction(undefined)
    }
  }

  const handleVerify = async () => {
    setError(undefined)
    setSuccess(undefined)

    if (!verificationCode.trim()) {
      setError('Verification code is required')
      return
    }

    setLoadingAction('verify')
    try {
      const result = await authClient.twoFactor.verifyTotp({
        code: verificationCode.trim()
      })
      if (result.error) {
        setError(getAuthErrorMessage(result.error, 'Invalid verification code'))
        return
      }

      const setupBackupCodes = setup?.backupCodes ?? []
      setEnabled(true)
      if (setupBackupCodes.length > 0) {
        setNewBackupCodes(setupBackupCodes)
      }
      setSetup(undefined)
      setPassword('')
      setVerificationCode('')
      setSuccess('Two-factor authentication is enabled')
      router.refresh()
    } catch {
      setError('Failed to verify code')
    } finally {
      setLoadingAction(undefined)
    }
  }

  const handleDisable = async () => {
    setError(undefined)
    setSuccess(undefined)

    if (!disablePassword) {
      setError('Current password is required')
      return
    }

    setLoadingAction('disable')
    try {
      const result = await authClient.twoFactor.disable({
        password: disablePassword
      })
      if (result.error) {
        setError(getAuthErrorMessage(result.error, 'Failed to disable 2FA'))
        return
      }

      setEnabled(false)
      setDisablePassword('')
      setNewBackupCodes([])
      setSuccess('Two-factor authentication is disabled')
      router.refresh()
    } catch {
      setError('Failed to disable 2FA')
    } finally {
      setLoadingAction(undefined)
    }
  }

  const handleGenerateBackupCodes = async () => {
    setError(undefined)
    setSuccess(undefined)

    if (!backupPassword) {
      setError('Current password is required')
      return
    }

    setLoadingAction('backup')
    try {
      const result = await authClient.twoFactor.generateBackupCodes({
        password: backupPassword
      })
      if (result.error) {
        setError(
          getAuthErrorMessage(result.error, 'Failed to generate backup codes')
        )
        return
      }

      setNewBackupCodes(result.data?.backupCodes ?? [])
      setBackupPassword('')
      setSuccess('New backup codes generated')
    } catch {
      setError('Failed to generate backup codes')
    } finally {
      setLoadingAction(undefined)
    }
  }

  const backupCodes = newBackupCodes.length
    ? newBackupCodes
    : (setup?.backupCodes ?? [])

  const codeGrid = (
    <div className="grid gap-2 sm:grid-cols-2">
      {backupCodes.map((code) => (
        <code
          key={code}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          {code}
        </code>
      ))}
    </div>
  )

  const copyCodesButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => copyText(backupCodes.join('\n'), 'Backup codes')}
    >
      <Copy />
      Copy
    </Button>
  )

  return (
    <>
      {error && <Alert title={error} />}
      {success && <Alert tone="success" title={success} />}

      <Frame divided className="overflow-hidden">
        {enabled ? (
          <Alert tone="success" flush title="Two-factor authentication is on">
            A verification code is required after password sign-in.
          </Alert>
        ) : (
          <Alert
            tone="warning"
            flush
            title="Two-factor authentication is off"
            action={
              !setup ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={handleStartSetup}
                  disabled={loadingAction === 'setup'}
                >
                  <ShieldCheck />
                  {loadingAction === 'setup' ? 'Starting...' : 'Set up'}
                </Button>
              ) : undefined
            }
          >
            Add an authenticator app to protect password sign-ins.
          </Alert>
        )}

        {!enabled && !setup && (
          <FormRow
            label="Current password"
            htmlFor="twoFactorPassword"
            hint="Enter your password, then choose Set up."
          >
            {({ describedBy }) => (
              <Input
                id="twoFactorPassword"
                type="password"
                autoComplete="current-password"
                aria-describedby={describedBy}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </FormRow>
        )}

        {setup && (
          <>
            <FormRow
              label="Authenticator app"
              hint="Scan this code with your authenticator app."
            >
              <div className="flex size-52 items-center justify-center rounded-md border bg-white p-3">
                {qrCodeUrl ? (
                  <img
                    src={qrCodeUrl}
                    alt="Authenticator app QR code"
                    className="size-48"
                  />
                ) : (
                  <span className="text-sm text-muted-foreground">
                    QR unavailable
                  </span>
                )}
              </div>
            </FormRow>
            <FormRow
              label="Manual setup key"
              htmlFor="twoFactorSetupKey"
              hint="Enter this key instead if you cannot scan the code."
            >
              <div className="flex gap-2">
                <Input
                  id="twoFactorSetupKey"
                  readOnly
                  value={setup.secret || setup.totpURI}
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Copy setup key"
                  onClick={() =>
                    copyText(setup.secret || setup.totpURI, 'Setup key')
                  }
                >
                  <Copy />
                </Button>
              </div>
            </FormRow>
            <FormRow
              label="Verification code"
              htmlFor="twoFactorCode"
              hint="Enter the code your app shows to finish setup."
            >
              <div className="space-y-2">
                <Input
                  id="twoFactorCode"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value)}
                />
                <Button
                  type="button"
                  onClick={handleVerify}
                  disabled={loadingAction === 'verify'}
                >
                  <Check />
                  {loadingAction === 'verify' ? 'Verifying...' : 'Verify code'}
                </Button>
              </div>
            </FormRow>
            {backupCodes.length > 0 && (
              <FormRow
                label="Backup codes"
                hint="Save these codes before leaving this page."
              >
                <div className="space-y-2">
                  {codeGrid}
                  {copyCodesButton}
                </div>
              </FormRow>
            )}
          </>
        )}

        {enabled && (
          <>
            <FormRow
              label="Generate backup codes"
              htmlFor="twoFactorBackupPassword"
              hint="Creating new backup codes invalidates the previous set."
            >
              <div className="space-y-2">
                <Input
                  id="twoFactorBackupPassword"
                  type="password"
                  autoComplete="current-password"
                  aria-label="Current password"
                  placeholder="Current password"
                  value={backupPassword}
                  onChange={(e) => setBackupPassword(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleGenerateBackupCodes}
                  disabled={loadingAction === 'backup'}
                >
                  <RefreshCw />
                  {loadingAction === 'backup'
                    ? 'Generating...'
                    : 'Generate codes'}
                </Button>
              </div>
            </FormRow>

            {backupCodes.length > 0 && (
              <FormRow
                label="Save your backup codes"
                hint="They are shown once. Store them somewhere safe."
              >
                <div className="space-y-2">
                  {codeGrid}
                  {copyCodesButton}
                </div>
              </FormRow>
            )}

            <FormRow
              label="Disable 2FA"
              htmlFor="twoFactorDisablePassword"
              hint="Password sign-ins will no longer ask for a verification code."
            >
              <div className="space-y-2">
                <Input
                  id="twoFactorDisablePassword"
                  type="password"
                  autoComplete="current-password"
                  aria-label="Current password"
                  placeholder="Current password"
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                />
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleDisable}
                  disabled={loadingAction === 'disable'}
                >
                  <ShieldOff />
                  {loadingAction === 'disable' ? 'Disabling...' : 'Disable 2FA'}
                </Button>
              </div>
            </FormRow>
          </>
        )}
      </Frame>
    </>
  )
}
