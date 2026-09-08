'use client'

import { Check, Copy, RefreshCw, ShieldCheck, ShieldOff } from 'lucide-react'
import { useRouter } from 'next/navigation'
import QRCode from 'qrcode'
import { FC, useEffect, useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
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
        issuer: serviceName
      })
      if (result.error) {
        setError(getAuthErrorMessage(result.error, 'Failed to start setup'))
        return
      }
      if (!result.data?.totpURI) {
        setError('Failed to start setup')
        return
      }

      setSetup({
        totpURI: result.data.totpURI,
        backupCodes: result.data.backupCodes ?? [],
        secret: getSecretFromTotpURI(result.data.totpURI)
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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-4">
        <div className="flex items-center gap-3">
          {enabled ? (
            <ShieldCheck className="size-5 text-green-600" />
          ) : (
            <ShieldOff className="size-5 text-muted-foreground" />
          )}
          <div>
            <p className="text-sm font-medium">
              {enabled ? 'Two-factor authentication is on' : '2FA is off'}
            </p>
            <p className="text-sm text-muted-foreground">
              {enabled
                ? 'A verification code is required after password sign-in.'
                : 'Add an authenticator app to protect password sign-ins.'}
            </p>
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {success && <p className="text-sm text-green-600">{success}</p>}

      {!enabled && !setup && (
        <div className="max-w-sm space-y-3">
          <div className="space-y-2">
            <Label htmlFor="twoFactorPassword">Current password</Label>
            <Input
              id="twoFactorPassword"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button
            type="button"
            onClick={handleStartSetup}
            disabled={loadingAction === 'setup'}
          >
            <ShieldCheck />
            {loadingAction === 'setup' ? 'Starting...' : 'Set up 2FA'}
          </Button>
        </div>
      )}

      {setup && (
        <div className="space-y-5">
          <div className="flex flex-col gap-4 md:flex-row">
            <div className="flex size-52 items-center justify-center rounded-lg border bg-white p-3">
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
            <div className="min-w-0 flex-1 space-y-3">
              <div className="space-y-2">
                <Label>Manual setup key</Label>
                <div className="flex gap-2">
                  <Input
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
              </div>
              <div className="space-y-2">
                <Label htmlFor="twoFactorCode">Verification code</Label>
                <Input
                  id="twoFactorCode"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value)}
                />
              </div>
              <Button
                type="button"
                onClick={handleVerify}
                disabled={loadingAction === 'verify'}
              >
                <Check />
                {loadingAction === 'verify' ? 'Verifying...' : 'Verify code'}
              </Button>
            </div>
          </div>

          {backupCodes.length > 0 && (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Backup codes</p>
                  <p className="text-sm text-muted-foreground">
                    Save these codes before leaving this page.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    copyText(backupCodes.join('\n'), 'Backup codes')
                  }
                >
                  <Copy />
                  Copy
                </Button>
              </div>
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
            </div>
          )}
        </div>
      )}

      {enabled && (
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">Generate backup codes</p>
              <p className="text-sm text-muted-foreground">
                Creating new backup codes invalidates the previous set.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="twoFactorBackupPassword">Current password</Label>
              <Input
                id="twoFactorBackupPassword"
                type="password"
                autoComplete="current-password"
                value={backupPassword}
                onChange={(e) => setBackupPassword(e.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={handleGenerateBackupCodes}
              disabled={loadingAction === 'backup'}
            >
              <RefreshCw />
              {loadingAction === 'backup' ? 'Generating...' : 'Generate codes'}
            </Button>
          </div>

          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">Disable 2FA</p>
              <p className="text-sm text-muted-foreground">
                Password sign-ins will no longer ask for a verification code.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="twoFactorDisablePassword">Current password</Label>
              <Input
                id="twoFactorDisablePassword"
                type="password"
                autoComplete="current-password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
              />
            </div>
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

          {backupCodes.length > 0 && (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-4 md:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">Save your backup codes</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    copyText(backupCodes.join('\n'), 'Backup codes')
                  }
                >
                  <Copy />
                  Copy
                </Button>
              </div>
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
            </div>
          )}
        </div>
      )}
    </div>
  )
}
