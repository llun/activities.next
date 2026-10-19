import { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FC } from 'react'

import {
  AuthCard,
  AuthCardActions,
  AuthCardBody,
  AuthCardFooter
} from '@/app/(nosidebar)/AuthCard'
import { getAuthLogoSrc } from '@/app/(nosidebar)/getAuthLogoSrc'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getVisitedSignUpDomain } from '@/lib/services/domains/visitedSignUpDomain'

import { UsernameField } from './UsernameField'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Sign up'
}

const Page: FC = async () => {
  const database = getDatabase()
  if (!database) throw new Error('Database is not available')

  // Sign-up creates the first profile on the domain this page is visited on,
  // under that domain's settings. When they are closed there is no sign-up to
  // show; send visitors to the landing, whose auth card says so.
  const signUpDomain = await getVisitedSignUpDomain(database)
  if (!signUpDomain.open) {
    return redirect('/')
  }

  const session = await getServerAuthSession()
  if (session && session.user) {
    return redirect('/')
  }

  return (
    <AuthCard
      logoSrc={getAuthLogoSrc()}
      title={`Join ${signUpDomain.displayName}`}
      description={`Create your profile on ${signUpDomain.domain}`}
    >
      <form method="post" action="/api/v1/accounts">
        <AuthCardBody>
          <UsernameField domain={signUpDomain.domain} />
          <FormRow
            stacked
            className="p-0"
            label="Full name"
            htmlFor="inputName"
          >
            <Input
              name="name"
              type="text"
              id="inputName"
              placeholder="Your display name"
            />
          </FormRow>
          <FormRow stacked className="p-0" label="Email" htmlFor="inputEmail">
            <Input name="email" type="email" id="inputEmail" />
          </FormRow>
          <FormRow
            stacked
            className="p-0"
            label="Password"
            htmlFor="inputPassword"
          >
            <Input name="password" type="password" id="inputPassword" />
          </FormRow>
        </AuthCardBody>

        <AuthCardActions>
          <Button type="submit" className="w-full">
            Sign up
          </Button>
          <AuthCardFooter>
            Already have an account?{' '}
            <Link
              href="/auth/signin"
              className="text-primary-text hover:underline"
            >
              Sign in
            </Link>
          </AuthCardFooter>
        </AuthCardActions>
      </form>
    </AuthCard>
  )
}

export default Page
