declare module '@upstash/qstash' {
  export class Client {
    constructor(config: { token: string })
    publishJSON(params: {
      url: string
      body: unknown
      timeout?: number
      retries?: number
      deduplicationId?: string
      headers?: Record<string, string>
      delay?: number
    }): Promise<unknown>
    dlq: {
      listMessages(params: { count?: number }): Promise<{
        messages?: Array<{
          dlqId: string
          messageId: string
          body?: string
          responseBody?: string
          responseStatus?: number
          maxRetries?: number
          createdAt: number
        }>
      }>
      retry(
        idOrOptions: string | { all?: boolean; dlqIds?: string[] }
      ): Promise<{
        responses?: unknown[]
      }>
      delete(
        idOrOptions: string | { all?: boolean; dlqIds?: string[] }
      ): Promise<{
        deleted?: number
      }>
    }
  }

  export class Receiver {
    constructor(config: { currentSigningKey: string; nextSigningKey: string })
    verify(params: {
      body: string
      signature: string
      url: string
    }): Promise<boolean>
  }
}

declare module '@google-cloud/tasks' {
  export namespace protos {
    namespace google {
      namespace cloud {
        namespace tasks {
          namespace v2 {
            export interface IHttpRequest {
              httpMethod?: string
              url?: string
              headers?: Record<string, string>
              body?: string
              oidcToken?: {
                serviceAccountEmail?: string
                audience?: string
              }
            }
            export interface ITask {
              httpRequest?: IHttpRequest
              scheduleTime?: {
                seconds?: number
              }
            }
          }
        }
      }
    }
  }

  export class CloudTasksClient {
    constructor(options?: unknown)
    createTask(params: {
      parent: string
      task: protos.google.cloud.tasks.v2.ITask
    }): Promise<unknown>
    queuePath(project: string, location: string, queue: string): string
    getProjectId(): Promise<string>
  }
}
