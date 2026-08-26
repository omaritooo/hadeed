export default defineNuxtPlugin(() => {
  const api = $fetch.create({
    credentials: 'include',
  })

  return { provide: { api } }
})
