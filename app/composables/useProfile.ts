import type { FetchError } from 'ofetch'
import type { UserProfile } from '~~/shared/types/profile.types'
import { useQuery } from '@pinia/colada'

export interface ProfileResponse {
  profile: UserProfile | null
  stats: { bmi: number, tdee: number | null } | null
}

export function useProfile() {
  const { $api } = useNuxtApp()

  return useQuery<ProfileResponse, FetchError<{ statusMessage: string }>>({
    key: () => ['profile'],
    query: () => $api<ProfileResponse>('/api/profile'),
  })
}
