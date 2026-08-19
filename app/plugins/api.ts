export default defineNuxtPlugin(() => {
  const api = $fetch.create({
    onRequest({ options }) {
      options.headers.set('x-user-id', 'test-user')
    },
  })

  return { provide: { api } }
})
