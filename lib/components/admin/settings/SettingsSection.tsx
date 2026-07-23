import { FC, ReactNode } from 'react'

// The section-card shell shared by every admin settings form, matching the
// settings-page pattern (rounded-2xl border, muted description, footer slot for
// the save bar).
interface SettingsSectionProps {
  title?: ReactNode
  description?: ReactNode
  footer?: ReactNode
  children: ReactNode
}

export const SettingsSection: FC<SettingsSectionProps> = ({
  title,
  description,
  footer,
  children
}) => (
  <section className="space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
    {(title || description) && (
      <div className="space-y-1">
        {title && <h2 className="text-lg font-semibold">{title}</h2>}
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
    )}
    {children}
    {footer && (
      <div className="flex items-center justify-end gap-3 pt-1">{footer}</div>
    )}
  </section>
)
