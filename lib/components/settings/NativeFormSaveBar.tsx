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
 *
 * A Radix `Switch` fires neither event: it is a `<button>` whose hidden form
 * input is updated with a plain `click` `Event`, which does not run the
 * checkbox's activation behaviour. So a click on a switch, checkbox or radio
 * role counts as an edit too.
 */
const CUSTOM_CONTROL_SELECTOR =
  '[role="switch"], [role="checkbox"], [role="radio"]'

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
    const markCustomControl = (event: Event) => {
      if (
        event.target instanceof Element &&
        event.target.closest(CUSTOM_CONTROL_SELECTOR)
      ) {
        markDirty()
      }
    }
    // Back or forward can restore this page from the browser's cache with the
    // submit it left from still "in flight"; the post is over, so it is not.
    const resetSaving = (event: PageTransitionEvent) => {
      if (event.persisted) setSaving(false)
    }
    form.addEventListener('submit', markSaving)
    form.addEventListener('click', markCustomControl)
    window.addEventListener('pageshow', resetSaving)
    return () => {
      form.removeEventListener('input', markDirty)
      form.removeEventListener('change', markDirty)
      form.removeEventListener('submit', markSaving)
      form.removeEventListener('click', markCustomControl)
      window.removeEventListener('pageshow', resetSaving)
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
