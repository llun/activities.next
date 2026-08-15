import { Metadata } from 'next'
import Link from 'next/link'
import { FC } from 'react'

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/lib/components/ui/card'
import {
  resolveAuthErrorContent,
  sanitizeAuthErrorCode
} from '@/lib/services/auth/errorPage'
import { logger } from '@/lib/utils/logger'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: Sign-in problem',
  // Nothing here is worth indexing, and the URL carries an error code that
  // reads as a real page to a crawler.
  robots: { index: false, follow: false }
}

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

// `error_description` is free text better-auth puts in the query string, and
// anyone can hand-craft a link to this page with any value in it. Log a bounded
// slice of it so an operator can still tell two failures apart, but never render
// it: prose we did not write, shown on our own signed-in-looking card, is a
// ready-made phishing surface ("Your account was suspended, call ..."). The
// visitor gets our copy for the code instead.
const MAX_LOGGED_DESCRIPTION_LENGTH = 200

const firstValue = (raw: string | string[] | undefined) =>
  Array.isArray(raw) ? raw[0] : raw

const Page: FC<Props> = async ({ searchParams }) => {
  const params = await searchParams
  const code = sanitizeAuthErrorCode(params.error)
  const content = resolveAuthErrorContent(code)

  // better-auth's own router never sees these failures — it short-circuits
  // onError for anything it redirects — so this is the only place they are
  // observable. Warn, not error: every one of them is a bad request from a
  // client, not a fault in this instance.
  logger.warn({
    message: 'Auth request failed and was redirected to the error page',
    errorCode: code ?? 'unknown',
    errorDescription:
      firstValue(params.error_description)?.slice(
        0,
        MAX_LOGGED_DESCRIPTION_LENGTH
      ) ?? null
  })

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">{content.title}</CardTitle>
        <CardDescription>{content.body}</CardDescription>
      </CardHeader>
      {code && (
        <CardContent>
          <div className="border-t pt-4 text-center">
            <code className="text-muted-foreground font-mono text-xs">
              {code}
            </code>
          </div>
        </CardContent>
      )}
      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          <Link
            href="/auth/signin"
            className="text-primary-text hover:underline"
          >
            Back to sign in
          </Link>
        </p>
      </CardFooter>
    </Card>
  )
}

export default Page
