import type { FetchError } from 'ofetch'
import type { MaybeRefOrGetter } from 'vue'
import type { BlockWithDays } from '~~/server/repositories/block.repository'
import { useQuery } from '@pinia/colada'
import { toValue } from 'vue'

export const useBlock = (id: MaybeRefOrGetter<number | null>) => {
  const { $api } = useNuxtApp()

  return useQuery<BlockWithDays, FetchError<{ statusMessage: string }>>({
    key: () => queryKeys.block(toValue(id) ?? -1),
    query: () => $api<BlockWithDays>(`/api/blocks/${toValue(id)}`),
    enabled: () => toValue(id) !== null,
  })
}
