import { FC } from 'react'

import { AuthCard } from '@/app/(nosidebar)/AuthCard'

interface AuthorizeInteractionErrorProps {
  title: string
  description: string
  uri?: string
  logoSrc?: string
}

export const AuthorizeInteractionError: FC<AuthorizeInteractionErrorProps> = ({
  title,
  description,
  uri,
  logoSrc
}) => (
  <AuthCard logoSrc={logoSrc} title={title} description={description}>
    {uri ? (
      // The value is whatever a remote server put in the query string, so it
      // is rendered as inert text — never as a link.
      <code className="block wrap-anywhere rounded-md bg-muted p-3 text-sm">
        {uri}
      </code>
    ) : null}
  </AuthCard>
)
