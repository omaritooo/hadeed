import type { FetchError } from 'ofetch'
import { useMutation } from '@pinia/colada'

export interface LoginInput {
  email: string
  password: string
  rememberMe: boolean
}

export const useLogin = () => {
  const { $api } = useNuxtApp()
  // Client-only, like the plugin that provides it.
  const outbox = import.meta.client ? useOutbox() : null

  return useMutation<{ userId: string }, LoginInput, FetchError<{ statusMessage: string }>>({
    mutation: input => $api<{ userId: string }>('/api/auth/login', {
      method: 'POST',
      body: input,
    }),
    // A 401 on replay pauses the queue and keeps the ops, waiting for exactly this. Without the
    // resume, a session that expired mid-workout leaves every set queued on the phone after the
    // lifter signs back in -- pending forever, with the sync pill saying so and nothing they can
    // do about it.
    onSuccess: () => {
      outbox?.resume()
    },
  })
}
