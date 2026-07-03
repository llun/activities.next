'use client'

import { Fingerprint } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { FC, useEffect, useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import { authClient } from '@/lib/services/auth/auth-client'

import { passkeyErrorMessage } from './passkeyErrorMessage'
import { isPlatformPasskeyAvailable } from './passkeySupport'
import { resolveSignInRedirect } from './resolveSignInRedirect'

interface PasskeySigninButtonProps {
  /**
   * Whether credential (email/password) sign-in is available on this instance.
   * When it is, an environment that can't use passkeys simply hides the button
   * (the visitor signs in with credentials instead). When it is NOT, passkeys
   * are the only way in, so an unsupported environment shows a short
   * "unavailable" notice rather than a blank sign-in card. Defaults to true.
   */
  credentialEnabled?: boolean
}

export const PasskeySigninButton: FC<PasskeySigninButtonProps> = ({
  credentialEnabled = true
}) => {
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  // `null` while we're still feature-detecting; `true`/`false` once resolved.
  // Starting at `null` keeps SSR and the first client render identical (both
  // render nothing), so there's no hydration mismatch — and no flash of the
  // "unavailable" notice on browsers that do support passkeys. In-app browsers
  // that can't use passkeys (iOS WKWebView, the Schrift login dialog, …) resolve
  // to `false`.
  const [supported, setSupported] = useState<boolean | null>(null)
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

  // Still feature-detecting — render nothing yet.
  if (supported === null) return null

  // Passkeys can't be used in this browser. If credential sign-in is available
  // the visitor still has a way in, so just hide the button; otherwise passkeys
  // were the only method, so explain the situation instead of a blank card.
  if (!supported) {
    if (credentialEnabled) return null
    return (
      // The notice is injected after client-side detection, so mark it as a
      // polite live region — otherwise assistive tech never announces the only
      // content telling the visitor they can't sign in here (WCAG 2.1 SC 4.1.3).
      <div
        role="status"
        aria-live="polite"
        className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3.5"
      >
        <span className="mt-px flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Fingerprint className="size-[15px]" />
        </span>
        <div>
          <p className="text-sm font-medium">
            Passkeys aren&apos;t available in this browser
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Signing in isn&apos;t available here.
          </p>
        </div>
      </div>
    )
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
