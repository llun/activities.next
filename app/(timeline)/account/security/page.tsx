import { KeyRound, ShieldCheck } from 'lucide-react'
import { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { ChangePasswordForm } from '@/app/(timeline)/account/security/ChangePasswordForm'
import { PasskeyManager } from '@/app/(timeline)/account/security/PasskeyManager'
import { TwoFactorManager } from '@/app/(timeline)/account/security/TwoFactorManager'
import { PageHeader } from '@/lib/components/page-header'
import { Section } from '@/lib/components/surface/Section'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { resolveAuthBaseURL } from '@/lib/services/auth/requestOrigin'
import {
  ensureDomainListed,
  getServedDomains
} from '@/lib/services/auth/servedDomains'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Account security'
}

const Page = async () => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Failed to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor || !actor.account) {
    return redirect('/auth/signin')
  }

  const account = actor.account
  const config = getConfig()
  const { serviceName } = config

  // Passkeys are scoped per domain; offer the domains this instance serves and
  // tell the manager which one the user is currently on so it can register here
  // directly and send cross-domain registrations to the right origin.
  const currentDomain = new URL(resolveAuthBaseURL(await headers(), config))
    .hostname
  // A wildcard trusted host resolves to a concrete subdomain that the served
  // list (which drops wildcards) won't include, so make sure the current domain
  // is always a chooser option.
  const servedDomains = ensureDomainListed(
    getServedDomains(config),
    currentDomain
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security"
        description="Protect how you sign in to this account."
      />

      <Section
        icon={KeyRound}
        title="Password"
        description="Change your password to keep your account secure."
      >
        <ChangePasswordForm />
      </Section>

      <Section
        icon={ShieldCheck}
        title="Two-factor authentication"
        description="Add a verification code after password sign-in."
      >
        <TwoFactorManager
          enabled={account.twoFactorEnabled}
          serviceName={serviceName ?? 'Activities.next'}
        />
      </Section>

      <PasskeyManager
        domains={servedDomains}
        currentDomain={currentDomain}
        handlePrefix={actor.username}
      />
    </div>
  )
}

export default Page
