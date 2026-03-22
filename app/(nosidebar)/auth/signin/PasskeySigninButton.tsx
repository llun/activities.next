'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { FC, useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import { authClient } from '@/lib/services/auth/auth-client'

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
        const error = result?.error as
          | { code?: string; message?: unknown }
          | undefined
        const code = error?.code
        const msg = error?.message
        if (code !== 'AUTH_CANCELLED' && typeof msg === 'string') {
          setError(msg)
        }
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
