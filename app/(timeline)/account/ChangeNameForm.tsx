'use client'

import { FC, useState } from 'react'

import { updateAccountName } from '@/lib/client'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { SaveBar } from '@/lib/components/surface/SaveBar'
import { Input } from '@/lib/components/ui/input'

interface Props {
  currentName: string
}

export const ChangeNameForm: FC<Props> = ({ currentName }) => {
  const [name, setName] = useState(currentName)
  // What the account holds now, so Save knows when there is nothing to save.
  const [savedName, setSavedName] = useState(currentName)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaved(false)
    setIsLoading(true)

    try {
      await updateAccountName({ name })

      setSavedName(name)
      setSaved(true)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'An error occurred. Please try again.'
      )
    } finally {
      setIsLoading(false)
    }
  }

  return (
    // method="post" is a real protection here, not just defense-in-depth: this
    // input is NAMED (name="name"), so on a native (pre-hydration/no-JS) submit it
    // is a successful control and a method-less <form> — which defaults to GET —
    // would serialize the name into the URL. POST keeps it in the request body.
    <form onSubmit={handleSubmit} method="post">
      <Frame
        footer={
          <SaveBar
            submit
            dirty={name !== savedName}
            saving={isLoading}
            saved={saved}
            error={error}
          />
        }
      >
        <FormRow label="Name" htmlFor="inputName">
          <Input
            name="name"
            type="text"
            id="inputName"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setSaved(false)
            }}
            placeholder="Your full name"
            maxLength={255}
          />
        </FormRow>
      </Frame>
    </form>
  )
}
