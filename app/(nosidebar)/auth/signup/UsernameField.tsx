'use client'

import { FC, useState } from 'react'

import { FormRow } from '@/lib/components/surface/FormRow'
import { Input } from '@/lib/components/ui/input'

interface Props {
  // The domain the profile is created on: the domain this page is visited on.
  domain: string
}

// The sign-up form's username row, with the full handle the profile will have
// on this domain under it ("Your profile will be @ana@run.example").
export const UsernameField: FC<Props> = ({ domain }) => {
  const [username, setUsername] = useState('')
  // The server lowercases the handle and refuses a leading @, so show it as made.
  const handle = username.trim().toLowerCase() || 'name'
  return (
    <FormRow
      stacked
      className="p-0"
      label="Username"
      htmlFor="inputUsername"
      hint={
        <>
          Your profile will be{' '}
          <span className="text-foreground font-medium break-all">
            @{handle}@{domain}
          </span>
        </>
      }
    >
      {({ describedBy }) => (
        <Input
          name="username"
          type="text"
          id="inputUsername"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={username}
          aria-describedby={describedBy}
          onChange={(event) => setUsername(event.target.value)}
        />
      )}
    </FormRow>
  )
}
