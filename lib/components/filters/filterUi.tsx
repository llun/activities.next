import { FC, ReactNode } from 'react'

interface FilterSectionProps {
  title?: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
}

// Settings-style section card, matching the shared chrome used across the
// settings pages (rounded-2xl, translucent surface, p-6).
export const FilterSection: FC<FilterSectionProps> = ({
  title,
  description,
  children,
  footer
}) => (
  <section className="space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
    {(title || description) && (
      <div>
        {title && <h2 className="text-lg font-semibold">{title}</h2>}
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
    )}
    {children}
    {footer && <div className="flex justify-end pt-1">{footer}</div>}
  </section>
)

interface FilterFieldProps {
  label: string
  htmlFor: string
  help?: ReactNode
  children: ReactNode
}

export const FilterField: FC<FilterFieldProps> = ({
  label,
  htmlFor,
  help,
  children
}) => (
  <div className="space-y-2">
    <label htmlFor={htmlFor} className="block text-sm font-medium">
      {label}
    </label>
    {children}
    {help && <p className="text-[0.8rem] text-muted-foreground">{help}</p>}
  </div>
)
