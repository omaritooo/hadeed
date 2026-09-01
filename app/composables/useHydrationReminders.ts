import type { PushSubscriptionInput } from '~~/shared/types/push.types'

const urlBase64ToUint8Array = (base64Url: string): Uint8Array<ArrayBuffer> => {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map(char => char.charCodeAt(0)))
}

export const useHydrationReminders = () => {
  const { $api } = useNuxtApp()
  const config = useRuntimeConfig()

  const isLoading = ref(false)
  const errorMessage = ref<string | null>(null)

  const postSettings = async (enabled: boolean, intervalMinutes: number): Promise<void> => {
    await $api('/api/hydration/reminders/settings', {
      method: 'POST',
      body: { enabled, intervalMinutes },
    })
  }

  const enable = async (intervalMinutes: number): Promise<boolean> => {
    isLoading.value = true
    errorMessage.value = null
    try {
      if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        errorMessage.value = 'Push notifications are not supported in this browser.'
        return false
      }
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        errorMessage.value = 'Notification permission was not granted.'
        return false
      }

      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.public.vapidPublicKey),
      })

      await $api('/api/push/subscribe', {
        method: 'POST',
        body: subscription.toJSON() as PushSubscriptionInput,
      })
      await postSettings(true, intervalMinutes)
      return true
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : 'Failed to enable reminders.'
      return false
    } finally {
      isLoading.value = false
    }
  }

  const disable = async (intervalMinutes: number): Promise<boolean> => {
    isLoading.value = true
    errorMessage.value = null
    try {
      await postSettings(false, intervalMinutes)
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready
        const subscription = await registration.pushManager.getSubscription()
        if (subscription) {
          await $api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: subscription.endpoint } })
          await subscription.unsubscribe()
        }
      }
      return true
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : 'Failed to disable reminders.'
      return false
    } finally {
      isLoading.value = false
    }
  }

  return { isLoading, errorMessage, enable, disable }
}
