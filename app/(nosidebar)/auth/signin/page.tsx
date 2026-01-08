import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { getProviders } from 'next-auth/react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FC } from 'react'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/lib/components/ui/card'
import { Separator } from '@/lib/components/ui/separator'
import { getDatabase } from '@/lib/database'

import { CredentialForm } from './CredentialForm'
import { SigninButton } from './SigninButton'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: Sign in'
}

const Page: FC = async () => {
  const database = getDatabase()
  const [providers, session] = await Promise.all([
    getProviders(),
    getServerSession(getAuthOptions())
  ])

  if (!database) throw new Error('Database is not available')
  if (session && session.user) {
    return redirect('/')
  }

  const credentialProvider = Object.values(providers ?? []).find(
    (p) => p.id === 'credentials'
  )
  const oauthProviders = Object.values(providers ?? []).filter(
    (p) => p.id !== 'credentials'
  )

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Welcome back</CardTitle>
        <CardDescription>Sign in to your account</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {credentialProvider && <CredentialForm provider={credentialProvider} />}

        {oauthProviders.length > 0 && credentialProvider && (
          <div className="relative">
            <Separator />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
              or continue with
            </span>
          </div>
        )}

        {oauthProviders.length > 0 && (
          <div className="space-y-2">
            {oauthProviders.map((provider) => (
              <SigninButton key={provider.id} provider={provider} />
            ))}
          </div>
        )}
      </CardContent>
      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          Don&apos;t have an account?{' '}
          <Link href="/auth/signup" className="text-primary hover:underline">
            Sign up
          </Link>
        </p>
      </CardFooter>
    </Card>
  )
}

export default Page
