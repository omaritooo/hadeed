// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  runtimeConfig: {
    tursoDatabaseUrl: process.env.TURSO_DATABASE_URL,
    tursoAuthToken: process.env.TURSO_AUTH_TOKEN,
  },

  nitro: {
    experimental: {
      openAPI: true,
    },
  },

  fonts: {
    families: [
      { name: 'Anybody', provider: 'google', weights: [600, 700, 800] },
      { name: 'Inter', provider: 'google', weights: [400, 500, 600, 700] },
      { name: 'JetBrains Mono', provider: 'google', weights: [700] },
    ],
  },

  css: ['@/assets/css/index.css'],
  vite: {
    plugins: [
      tailwindcss(),
    ],
  },

  modules: [
    '@nuxt/a11y',
    '@nuxt/eslint',
    '@nuxt/fonts',
    '@nuxt/hints',
    '@nuxt/icon',
    '@nuxt/image',
    '@nuxt/scripts',
    '@nuxt/test-utils',
    '@artmizu/nuxt-prometheus',
    '@norbiros/nuxt-auto-form',
    '@nuxtjs/device',
    '@nuxtjs/i18n',
    '@nuxtjs/seo',
    '@vite-pwa/nuxt',
    '@vueuse/nuxt',
    '@pinia/nuxt',
    '@pinia/colada-nuxt'
  ],
  components: [
    {
      path: '~/components',
      extensions: ['vue']
    }
  ]
})