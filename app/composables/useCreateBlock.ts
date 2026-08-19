import type { FetchError } from 'ofetch'
import type { CreateFromScratchInput } from '~~/server/services/split.service'
import type { Block } from '~~/shared/types/split.types'
import { useMutation } from '@pinia/colada'

export function useCreateBlock() {
  const { $api } = useNuxtApp()

  return useMutation<Block, CreateFromScratchInput, FetchError<{ statusMessage: string }>>({
    mutation: input => $api<Block>('/api/blocks', {
      method: 'POST',
      body: input,
    }),
  })
}
