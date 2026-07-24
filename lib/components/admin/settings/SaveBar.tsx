import { FC } from 'react'

import { Button } from '@/lib/components/ui/button'

// The per-section save footer: an inline error, an "Unsaved changes" hint, a
// transient "Saved" badge, and the Update button (disabled until the section is
// dirty). Rendered inside a SettingsSection footer. Dirty wins over Saved so a
// fresh edit never claims the section is already saved.
interface SaveBarProps {
  dirty: boolean
  saving: boolean
  saved: boolean
  error?: string | null
  onSave: () => void
  label?: string
}

export const SaveBar: FC<SaveBarProps> = ({
  dirty,
  saving,
  saved,
  error,
  onSave,
  label = 'Update'
}) => (
  <>
    {error && <p className="text-sm text-destructive">{error}</p>}
    {!error && dirty && (
      <span className="text-sm text-muted-foreground">Unsaved changes</span>
    )}
    {!error && !dirty && saved && (
      <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
        Saved
      </span>
    )}
    <Button onClick={onSave} disabled={saving || !dirty}>
      {saving ? 'Saving…' : label}
    </Button>
  </>
)
