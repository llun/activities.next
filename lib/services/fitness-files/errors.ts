export class QuotaExceededError extends Error {
  constructor(
    message: string,
    public used: number,
    public limit: number
  ) {
    super(message)
    this.name = 'QuotaExceededError'
    Object.setPrototypeOf(this, QuotaExceededError.prototype)
  }
}
