import type { FetchError } from 'ofetch'
import type { CompleteOnboardingInput } from '~~/server/services/profile.service'
import type { UserProfile, UserTarget } from '~~/shared/types/profile.types'
import { useMutation } from '@pinia/colada'

export type CompletedOnboardingProfile = (UserProfile & { displayName: string | null, targets: UserTarget[] }) | null

export const useCompleteOnboarding = () => {
  const { $api } = useNuxtApp()

  return useMutation<CompletedOnboardingProfile, CompleteOnboardingInput, FetchError<{ statusMessage: string }>>({
    mutation: input => $api<CompletedOnboardingProfile>('/api/profile/onboarding', {
      method: 'POST',
      body: input,
    }),
  })
}
