// Client-only: the outbox plugin isn't registered during SSR, where there is nothing to queue and
// no IndexedDB to queue it in. Call this from `onMounted` or behind a `ClientOnly`, not from a
// setup body that also runs on the server.
export const useOutbox = () => {
  const { $outbox } = useNuxtApp()
  return $outbox
}
