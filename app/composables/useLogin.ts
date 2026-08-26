import type { FetchError } from 'ofetch'
import { useMutation } from '@pinia/colada'

export interface LoginInput {
  email: string
  password: string
  rememberMe: boolean
}

export function useLogin() {
  const { $api } = useNuxtApp()

  return useMutation<{ userId: string }, LoginInput, FetchError<{ statusMessage: string }>>({
    mutation: input => $api<{ userId: string }>('/api/auth/login', {
      method: 'POST',
      body: input,
    }),
  })
}
