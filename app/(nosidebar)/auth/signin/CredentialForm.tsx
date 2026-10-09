'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { FC, FormEvent, useRef, useState } from 'react'

import { Alert } from '@/lib/components/surface/Alert'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { authClient } from '@/lib/services/auth/auth-client'
import { normalizeEmail } from '@/lib/utils/normalizeEmail'

import { resolveSignInRedirect } from './resolveSignInRedirect'

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
  const [fieldError, setFieldError] = useState<{
    field: 'email' | 'password'
    message: string
  }>()
  const [loading, setLoading] = useState(false)
  const searchParams = useSearchParams()
  const router = useRouter()
  const emailInputRef = useRef<HTMLInputElement>(null)
  const passwordInputRef = useRef<HTMLInputElement>(null)

  const clearFieldError = (field: 'email' | 'password') =>
    setFieldError((current) => (current?.field === field ? undefined : current))

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(undefined)
    setFieldError(undefined)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const email = formData.get('email')
    const password = formData.get('password')

    if (typeof email !== 'string' || !email.trim()) {
      setFieldError({ field: 'email', message: 'Email is required' })
      // Focus moves to the invalid input so its description is read.
      emailInputRef.current?.focus()
      setLoading(false)
      return
    }
    if (typeof password !== 'string' || !password) {
      setFieldError({ field: 'password', message: 'Password is required' })
      passwordInputRef.current?.focus()
      setLoading(false)
      return
    }

    const redirectBack = resolveSignInRedirect(searchParams)

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
    // method="post" is required here, not just defense-in-depth: unlike the other
    // auth forms, these inputs are uncontrolled and NAMED (name="email"/"password",
    // read via FormData), so they ARE successful form controls. handleSubmit calls
    // preventDefault, but if the form is submitted before hydration or with JS
    // disabled the browser falls back to a native submit, and a method-less <form>
    // defaults to GET — serializing the email and password into the URL query
    // string (leaking them into history, logs, and Referer). POST keeps the
    // credentials in the request body in every case.
    <form onSubmit={handleSubmit} method="post" className="space-y-4">
      <Frame divided>
        <FormRow stacked label="Email" htmlFor="inputEmail">
          <Input
            ref={emailInputRef}
            name="email"
            type="email"
            id="inputEmail"
            aria-invalid={fieldError?.field === 'email' ? true : undefined}
            aria-describedby={
              fieldError?.field === 'email' ? 'inputEmail-error' : undefined
            }
            onChange={() => clearFieldError('email')}
          />
          {fieldError?.field === 'email' && (
            <p
              id="inputEmail-error"
              className="mt-2 text-xs text-destructive-text"
            >
              {fieldError.message}
            </p>
          )}
        </FormRow>
        <FormRow stacked label="Password" htmlFor="inputPassword">
          <Input
            ref={passwordInputRef}
            name="password"
            type="password"
            id="inputPassword"
            aria-invalid={fieldError?.field === 'password' ? true : undefined}
            aria-describedby={
              fieldError?.field === 'password'
                ? 'inputPassword-error'
                : undefined
            }
            onChange={() => clearFieldError('password')}
          />
          {fieldError?.field === 'password' && (
            <p
              id="inputPassword-error"
              className="mt-2 text-xs text-destructive-text"
            >
              {fieldError.message}
            </p>
          )}
        </FormRow>
      </Frame>
      <div className="text-right">
        <Link
          href="/auth/forgot-password"
          className="text-sm text-primary-text hover:underline"
        >
          Forgot password?
        </Link>
      </div>

      {error && <Alert title={error} />}

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? 'Signing in…' : `Sign in with ${providerName}`}
      </Button>
    </form>
  )
}
