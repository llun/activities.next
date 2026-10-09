import { Metadata } from 'next'
import Link from 'next/link'
import { FC } from 'react'

import { AuthCard, AuthCardFooter } from '@/app/(nosidebar)/AuthCard'
import { getAuthLogoSrc } from '@/app/(nosidebar)/getAuthLogoSrc'

import { ResetPasswordForm } from './ResetPasswordForm'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: Reset Password'
}

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const Page: FC<Props> = async ({ searchParams }) => {
  const { code } = await searchParams
  const passwordResetCode = Array.isArray(code) ? code[0] : code

  return (
    <AuthCard
      logoSrc={getAuthLogoSrc()}
      title="Reset your password"
      description="Set a new password for your account."
      footer={
        <AuthCardFooter>
          Need a new reset link?{' '}
          <Link
            href="/auth/forgot-password"
            className="text-primary-text hover:underline"
          >
            Request one
          </Link>
        </AuthCardFooter>
      }
    >
      <ResetPasswordForm initialCode={passwordResetCode} />
    </AuthCard>
  )
}

export default Page
