'use client'

import { FC, useEffect, useRef, useState } from 'react'

import { SaveBar } from '@/lib/components/surface/SaveBar'

interface Props {
  className?: string
}

/**
 * The `SaveBar` for a form that posts natively to a route (the profile and
 * account image forms): the page redirects after the post, so there is no
 * client-side request to track. It lives inside the `<form>`, reads edits from
 * the `input` and `change` events that bubble up to it (an upload field that
 * changes its hidden value dispatches one), enables Save from the first edit,
 * and is the form's submit button.
 */
export const NativeFormSaveBar: FC<Props> = ({ className }) => {
  const anchorRef = useRef<HTMLDivElement>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const form = anchorRef.current?.closest('form')
    if (!form) return
    const markDirty = () => setDirty(true)
    // `submit` only fires once the browser's own validation has passed.
    const markSaving = () => setSaving(true)
    form.addEventListener('input', markDirty)
    form.addEventListener('change', markDirty)
    form.addEventListener('submit', markSaving)
    return () => {
      form.removeEventListener('input', markDirty)
      form.removeEventListener('change', markDirty)
      form.removeEventListener('submit', markSaving)
    }
  }, [])

  return (
    <div ref={anchorRef} data-slot="native-form-save-bar">
      <SaveBar
        className={className}
        dirty={dirty}
        saving={saving}
        saved={false}
        submit
      />
    </div>
  )
}
