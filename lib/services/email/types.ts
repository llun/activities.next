export type Email = string | { name: string; email: string }
export interface Message {
  from: Email
  to: Email[]
  replyTo?: Email
  subject: string
  content: {
    text: string
    html: string
  }
}

export interface BaseEmailSettings {
  serviceFromAddress: string
}
