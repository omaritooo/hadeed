import { createClient } from '@libsql/client'

let client: ReturnType<typeof createClient> | undefined

export const useDb = () => {
  if (!client) {
    const config = useRuntimeConfig()
    client = createClient({
      url: config.tursoDatabaseUrl,
      authToken: config.tursoAuthToken,
    })
  }
  return client
}
