'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { FC, useEffect, useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import { authClient } from '@/lib/services/auth/auth-client'

import { passkeyErrorMessage } from './passkeyErrorMessage'
import { isPlatformPasskeyAvailable } from './passkeySupport'
import { resolveSignInRedirect } from './resolveSignInRedirect'

export const PasskeySigninButton: FC = () => {
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  // Start hidden and reveal only once we've confirmed the client can complete a
  // platform passkey ceremony. Both SSR and the first client render produce the
  // same `null`, so there's no hydration mismatch, and in-app browsers that
  // can't use passkeys (iOS WKWebView, the Schrift login dialog, …) never show
  // the button at all.
  const [supported, setSupported] = useState(false)
  const searchParams = useSearchParams()
  const router = useRouter()

  useEffect(() => {
    let active = true
    isPlatformPasskeyAvailable().then((available) => {
      if (active) setSupported(available)
    })
    return () => {
      active = false
    }
  }, [])

  const handlePasskeySignin = async () => {
    setError(undefined)
    setLoading(true)
    const redirectBack = resolveSignInRedirect(searchParams)
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

  if (!supported) return null

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
