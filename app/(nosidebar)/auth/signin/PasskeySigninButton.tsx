'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { FC, useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import { authClient } from '@/lib/services/auth/auth-client'

// better-auth's passkey client always sets `message` to "Auth cancelled"
// regardless of the real failure and only varies the `code`, so the raw message
// is misleading. Map the meaningful WebAuthn error codes to actionable text, and
// stay silent only when the user genuinely dismissed the system prompt.
const passkeyErrorMessage = (code?: string): string | null => {
  switch (code) {
    // Genuine user dismissal/timeout: @simplewebauthn maps the browser's
    // NotAllowedError to ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY (not
    // ERROR_CEREMONY_ABORTED, which is only a programmatic abort), and
    // better-auth reports AUTH_CANCELLED when no WebAuthnError is thrown. Stay
    // silent for all of these so dismissing the prompt isn't shown as an error.
    case 'AUTH_CANCELLED':
    case 'ERROR_CEREMONY_ABORTED':
    case 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY':
      return null
    case 'ERROR_INVALID_RP_ID':
    case 'ERROR_INVALID_DOMAIN':
      return 'This passkey cannot be used on this domain. Sign in with your email and password instead.'
    default:
      return 'Passkey sign in failed. Please try again.'
  }
}

export const PasskeySigninButton: FC = () => {
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const searchParams = useSearchParams()
  const router = useRouter()

  const handlePasskeySignin = async () => {
    setError(undefined)
    setLoading(true)
    const raw = searchParams.get('redirectBack') || '/'
    const redirectBack =
      raw.startsWith('/') && !raw.startsWith('//') ? raw : '/'
    try {
      const result = await authClient.signIn.passkey({ autoFill: false })
      if (!result || result.error) {
        const code = (result?.error as { code?: string } | undefined)?.code
        const message = passkeyErrorMessage(code)
        if (message) setError(message)
        setLoading(false)
        return
      }
      setLoading(false)
      router.push(redirectBack)
    } catch {
      setError('Passkey sign in failed. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="space-y-1">
      <Button
        variant="outline"
        className="w-full"
        onClick={handlePasskeySignin}
        disabled={loading}
      >
        {loading ? 'Signing in...' : 'Sign in with Passkey'}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
