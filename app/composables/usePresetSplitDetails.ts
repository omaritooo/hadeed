import type { FetchError } from 'ofetch'
import type { MaybeRefOrGetter } from 'vue'
import type { PresetSplitWithDays } from '~~/server/repositories/preset-split.repository'
import { useQuery } from '@pinia/colada'
import { toValue } from 'vue'

export const usePresetSplitDetails = (id: MaybeRefOrGetter<number | null>) => {
  const { $api } = useNuxtApp()

  return useQuery<PresetSplitWithDays, FetchError<{ statusMessage: string }>>({
    key: () => queryKeys.presetSplitDetails(toValue(id) ?? -1),
    query: () => $api<PresetSplitWithDays>(`/api/preset-splits/${toValue(id)}`),
    enabled: () => toValue(id) !== null,
  })
}
