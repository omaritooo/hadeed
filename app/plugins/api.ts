export default defineNuxtPlugin(() => {
  // On the server, this $fetch call is Nitro calling its own API over HTTP -- there's no browser
  // cookie jar for `credentials: 'include'` to draw from, so the session cookie has to be forwarded
  // explicitly from the original incoming request or every server-rendered fetch 401s.
  const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined

  const api = $fetch.create({
    credentials: 'include',
    headers,
  })

  return { provide: { api } }
})
