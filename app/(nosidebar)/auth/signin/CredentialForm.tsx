'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { FC, FormEvent, useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import { authClient } from '@/lib/services/auth/auth-client'
import { normalizeEmail } from '@/lib/utils/normalizeEmail'

interface Props {
  providerName: string
}

const requiresTwoFactor = (
  data: unknown
): data is { twoFactorRedirect: true } => {
  if (!data || typeof data !== 'object') return false
  // better-auth 1.6.6's twoFactorClient checks this response field but
  // does not export a typed guard; re-verify this on better-auth upgrades.
  return Reflect.get(data, 'twoFactorRedirect') === true
}

export const CredentialForm: FC<Props> = ({ providerName }) => {
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const searchParams = useSearchParams()
  const router = useRouter()

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(undefined)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const email = formData.get('email')
    const password = formData.get('password')

    if (typeof email !== 'string' || !email.trim()) {
      setError('Email is required')
      setLoading(false)
      return
    }
    if (typeof password !== 'string' || !password) {
      setError('Password is required')
      setLoading(false)
      return
    }

    const raw = searchParams.get('redirectBack') || '/'
    const redirectBack =
      raw.startsWith('/') && !raw.startsWith('//') ? raw : '/'

    try {
      const result = await authClient.signIn.email({
        // Emails are stored and looked up case-insensitively; normalize through
        // the shared primitive so the sign-in lookup matches regardless of how
        // the user typed it (and never drifts from server-side normalization).
        email: normalizeEmail(email),
        password
      })
      if (result.error) {
        setError(result.error.message || 'Sign in failed')
        setLoading(false)
        return
      }
      if (requiresTwoFactor(result.data)) {
        router.push(
          `/auth/two-factor?redirectBack=${encodeURIComponent(redirectBack)}`
        )
        return
      }
      router.push(redirectBack)
    } catch {
      setError('Sign in failed. Please try again.')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="inputEmail">Email</Label>
        <Input name="email" type="email" id="inputEmail" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="inputPassword">Password</Label>
        <Input name="password" type="password" id="inputPassword" />
      </div>
      <div className="text-right">
        <Link
          href="/auth/forgot-password"
          className="text-sm text-primary hover:underline"
        >
          Forgot password?
        </Link>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? 'Signing in...' : `Sign in with ${providerName}`}
      </Button>
    </form>
  )
}
