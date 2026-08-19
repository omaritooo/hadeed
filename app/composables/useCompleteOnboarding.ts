import type { FetchError } from 'ofetch'
import type { CompleteOnboardingInput } from '~~/server/services/profile.service'
import type { UserProfile } from '~~/shared/types/profile.types'
import { useMutation } from '@pinia/colada'

export function useCompleteOnboarding() {
  const { $api } = useNuxtApp()

  return useMutation<UserProfile | null, CompleteOnboardingInput, FetchError<{ statusMessage: string }>>({
    mutation: input => $api<UserProfile | null>('/api/profile/onboarding', {
      method: 'POST',
      body: input,
    }),
  })
}
