import webpush from 'web-push'

let configured = false

export const configureWebPush = (): void => {
  if (configured) return
  const config = useRuntimeConfig()
  webpush.setVapidDetails('mailto:support@hadeed.app', config.vapidPublicKey, config.vapidPrivateKey)
  configured = true
}
