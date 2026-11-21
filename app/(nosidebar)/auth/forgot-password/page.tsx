import { Metadata } from 'next'
import Link from 'next/link'
import { FC } from 'react'

import { AuthCard, AuthCardFooter } from '@/app/(nosidebar)/AuthCard'
import { getAuthLogoSrc } from '@/app/(nosidebar)/getAuthLogoSrc'

import { RequestPasswordResetForm } from './RequestPasswordResetForm'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Forgot Password'
}

const Page: FC = async () => {
  return (
    <AuthCard
      logoSrc={getAuthLogoSrc()}
      title="Forgot your password?"
      description="Enter your email and we'll send you a link to reset it."
    >
      <RequestPasswordResetForm
        footer={
          <AuthCardFooter>
            Remembered your password?{' '}
            <Link
              href="/auth/signin"
              className="text-primary-text hover:underline"
            >
              Sign in
            </Link>
          </AuthCardFooter>
        }
      />
    </AuthCard>
  )
}

export default Page
