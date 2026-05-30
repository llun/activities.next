import { Metadata } from 'next'
import Image from 'next/image'
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
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'

import { CredentialForm } from './CredentialForm'
import { PasskeySigninButton } from './PasskeySigninButton'

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
  const credentialEnabled = auth?.enableCredential !== false

  return (
    <Card>
      <CardHeader className="items-center text-center">
        <Image
          src="/logo-nav.png"
          alt=""
          aria-hidden="true"
          width={48}
          height={48}
          className="mx-auto mb-2 h-12 w-12 object-contain"
        />
        <CardTitle className="text-2xl">
          Sign in to {serviceName ?? 'Activities'}
        </CardTitle>
        <CardDescription>
          Your self-hosted corner of the Fediverse.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {credentialEnabled && (
          <CredentialForm providerName={serviceName ?? 'credentials'} />
        )}

        <PasskeySigninButton />
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
