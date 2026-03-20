'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { FC, FormEvent, useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'
import { authClient } from '@/lib/services/auth/auth-client'

interface Props {
  providerName: string
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
    const email = formData.get('email') as string
    const password = formData.get('password') as string
    const redirectBack = searchParams.get('redirectBack') || '/'

    const result = await authClient.signIn.email({
      email,
      password
    })

    if (result.error) {
      setError(result.error.message || 'Sign in failed')
      setLoading(false)
      return
    }

    router.push(redirectBack)
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
