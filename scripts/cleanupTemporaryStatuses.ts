import { getConfig } from '../lib/config'
import { getDatabase } from '../lib/database'

const main = async () => {
    const config = getConfig()
    const database = getDatabase()
    if (!database) {
        console.error('Database not available')
        process.exit(1)
    }

    console.log('Cleaning up expired temporary statuses...')
    await database.deleteExpiredTemporaryStatuses()
    console.log('Done.')

    await database.destroy()
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
