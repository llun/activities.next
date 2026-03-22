import { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FC } from 'react'

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/lib/components/ui/card'
import { Separator } from '@/lib/components/ui/separator'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'

import { CredentialForm } from './CredentialForm'
import { PasskeySigninButton } from './PasskeySigninButton'
import { SigninButton } from './SigninButton'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: Sign in'
}

const Page: FC = async () => {
  const database = getDatabase()
  const session = await getServerAuthSession()

  if (!database) throw new Error('Database is not available')
  if (session && session.user) {
    return redirect('/')
  }

  const { auth, serviceName } = getConfig()
  const oauthProviders = auth?.github ? [{ id: 'github', name: 'GitHub' }] : []
  const credentialEnabled = auth?.enableCredential !== false
  const hasAlternativeProviders = oauthProviders.length > 0

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Welcome back</CardTitle>
        <CardDescription>Sign in to your account</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {credentialEnabled && (
          <CredentialForm providerName={serviceName ?? 'credentials'} />
        )}

        {credentialEnabled && (
          <div className="relative">
            <Separator />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
              or continue with
            </span>
          </div>
        )}

        <div className="space-y-2">
          <PasskeySigninButton />
          {hasAlternativeProviders &&
            oauthProviders.map((provider) => (
              <SigninButton key={provider.id} provider={provider} />
            ))}
        </div>
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
