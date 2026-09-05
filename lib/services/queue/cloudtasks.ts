import { CloudTasksClient, protos } from '@google-cloud/tasks'
import { context, propagation } from '@opentelemetry/api'

import { CloudTasksConfig } from '@/lib/config/queue'
import { withSpan } from '@/lib/utils/trace'

import { defaultJobHandle } from './base'
import { JobMessage, Queue } from './type'

export class CloudTasksQueue implements Queue {
  readonly runsInline = false

  private _config?: CloudTasksConfig
  private _client?: CloudTasksClient

  constructor(config?: CloudTasksConfig, client?: CloudTasksClient) {
    this._config = config
    this._client = client
  }

  private getClient(): CloudTasksClient {
    if (!this._client) {
      this._client = new CloudTasksClient()
    }
    return this._client
  }

  async publish(message: JobMessage): Promise<void> {
    return withSpan('queue', 'publish', { jobName: message.name }, async () => {
      const url = this._config?.url
      if (!url) {
        throw new Error('Cloud Tasks queue URL is not configured')
      }

      const queue = this._config?.queue
      if (!queue) {
        throw new Error('Cloud Tasks queue name is not configured')
      }

      const client = this.getClient()
      const project = this._config?.project || (await client.getProjectId())
      const location = this._config?.location || 'europe-west1'
      const parent = client.queuePath(project, location, queue)

      const traceHeaders: Record<string, string> = {}
      propagation.inject(context.active(), traceHeaders)

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...traceHeaders
      }

      if (this._config?.secret) {
        headers['x-cloudtasks-secret'] = this._config.secret
        if (!this._config.serviceAccount) {
          headers['Authorization'] = `Bearer ${this._config.secret}`
        }
      }

      const httpRequest: protos.google.cloud.tasks.v2.IHttpRequest = {
        httpMethod: 'POST',
        url,
        headers,
        body: Buffer.from(JSON.stringify(message)).toString('base64')
      }

      if (this._config?.serviceAccount) {
        httpRequest.oidcToken = {
          serviceAccountEmail: this._config.serviceAccount,
          ...(this._config.audience ? { audience: this._config.audience } : {})
        }
      }

      const task: protos.google.cloud.tasks.v2.ITask = {
        httpRequest
      }

      if (message.delaySeconds && message.delaySeconds > 0) {
        task.scheduleTime = {
          seconds: Math.floor(Date.now() / 1000) + message.delaySeconds
        }
      }

      await client.createTask({ parent, task })
    })
  }

  handle(message: JobMessage) {
    return defaultJobHandle('cloudtasks')(message)
  }
}
