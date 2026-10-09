import { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FC } from 'react'

import { AuthCard, AuthCardFooter } from '@/app/(nosidebar)/AuthCard'
import { getAuthLogoSrc } from '@/app/(nosidebar)/getAuthLogoSrc'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { Booleanish } from '@/lib/utils/zodBooleanish'

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
  const params = toSearchParams(await searchParams)
  // Mastodon `force_login`: /oauth/authorize forwards force_login=true when
  // the client demands a fresh interactive login. Skip the
  // already-authenticated auto-resume so the form renders; the eventual
  // sign-in resumes via the accompanying redirectBack (which omits
  // force_login). safeParse fails on a missing param, which reads as false.
  const forceLoginParam = Booleanish.safeParse(params.get('force_login'))
  const forceLogin = forceLoginParam.success && forceLoginParam.data
  if (session && session.user && !forceLogin) {
    const target = resolveSignInRedirect(params)
    // Only forward to the consent page when the session has a usable actor —
    // /oauth/authorize bounces an actor-less session straight back here, so
    // resuming without one would loop. Plain logins (target '/') skip the lookup.
    if (target === '/') return redirect('/')
    const actor = await getActorFromSession(database, session)
    return redirect(actor ? target : '/')
  }

  const { auth, serviceName } = getConfig()
  const {
    registrations: { open: registrationOpen }
  } = await getResolvedServerSettings(database)
  const credentialEnabled = auth?.enableCredential !== false

  return (
    <AuthCard
      logoSrc={getAuthLogoSrc()}
      title={`Sign in to ${serviceName ?? 'Activities'}`}
      description="Your self-hosted corner of the Fediverse."
      footer={
        registrationOpen ? (
          <AuthCardFooter>
            Don&apos;t have an account?{' '}
            <Link
              href="/auth/signup"
              className="text-primary-text hover:underline"
            >
              Sign up
            </Link>
          </AuthCardFooter>
        ) : undefined
      }
    >
      {credentialEnabled && (
        <CredentialForm providerName={serviceName ?? 'credentials'} />
      )}

      <PasskeySigninButton credentialEnabled={credentialEnabled} />
    </AuthCard>
  )
}

export default Page
