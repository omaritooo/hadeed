export default defineNuxtPlugin(() => {
  const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined

  const api = $fetch.create({
    credentials: 'include',
    headers,
  })

  return { provide: { api } }
})
