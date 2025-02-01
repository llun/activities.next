export const cleanJson = <T>(json: T): T => JSON.parse(JSON.stringify(json))
