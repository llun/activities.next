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
import { getBaseURL, getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { CredentialForm } from './CredentialForm'
import { PasskeySigninButton } from './PasskeySigninButton'
import { resolveSignInRedirect } from './resolveSignInRedirect'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: Sign in'
}

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

// The sign-in forms resume an in-flight OAuth/OIDC request after a fresh login
// (see resolveSignInRedirect). A relying party that targets better-auth's
// authorize endpoint (the advertised authorization_endpoint), or a custom
// /oauth/authorize link, can also land an *already-authenticated* visitor here
// — better-auth bounces a logged-out authorize to /auth/signin, and the user may
// have signed in elsewhere in between. Build the same URLSearchParams the forms
// see so this server entrypoint resumes the request identically instead of
// dropping it on the home timeline.
const toSearchParams = (
  raw: Record<string, string | string[] | undefined>
): URLSearchParams => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value))
      value.forEach((entry) => params.append(key, entry))
    else if (value != null) params.append(key, value)
  }
  return params
}

const Page: FC<Props> = async ({ searchParams }) => {
  const database = getDatabase()
  const session = await getServerAuthSession()

  if (!database) throw new Error('Database is not available')
  if (session && session.user) {
    const target = resolveSignInRedirect(toSearchParams(await searchParams))
    // Only forward to the consent page when the session has a usable actor —
    // /oauth/authorize bounces an actor-less session straight back here, so
    // resuming without one would loop. Plain logins (target '/') skip the lookup.
    if (target === '/') return redirect('/')
    const actor = await getActorFromSession(database, session)
    return redirect(actor ? target : '/')
  }

  const { auth, serviceName, registrationOpen } = getConfig()
  const credentialEnabled = auth?.enableCredential !== false

  // Use an absolute URL on the configured host (ACTIVITIES_HOST) so the logo
  // resolves against the canonical origin instead of the request host. When the
  // instance is served behind a CDN on an alias domain, a root-relative
  // `/logo-nav.png` can be intercepted and redirected away from the app origin.
  const logoSrc = new URL('/logo-nav.png', getBaseURL()).toString()

  return (
    <Card>
      <CardHeader className="items-center text-center">
        <Image
          src={logoSrc}
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
      {registrationOpen && (
        <CardFooter className="justify-center">
          <p className="text-sm text-muted-foreground">
            Don&apos;t have an account?{' '}
            <Link href="/auth/signup" className="text-primary hover:underline">
              Sign up
            </Link>
          </p>
        </CardFooter>
      )}
    </Card>
  )
}

export default Page
