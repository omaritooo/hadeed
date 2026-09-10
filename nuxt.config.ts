import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  runtimeConfig: {
    tursoDatabaseUrl: process.env.TURSO_DATABASE_URL,
    tursoAuthToken: process.env.TURSO_AUTH_TOKEN,
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY,
    cronSecret: process.env.CRON_SECRET,
    public: {
      vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
    },
  },

  nitro: {
    experimental: {
      openAPI: true,
    },
  },

  app: {
    head: {
      link: [
        // SVG first: browsers that support it pick it and get a crisp mark at any size.
        // The .ico stays as the legacy fallback, and apple-touch-icon is what iOS uses
        // for the home-screen tile (it must be opaque -- iOS renders alpha as black).
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico', sizes: '16x16 32x32 48x48' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png', sizes: '180x180' },
      ],
    },
  },

  pwa: {
    strategies: 'injectManifest',
    srcDir: '.',
    filename: 'sw.ts',
    injectManifest: {
      globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
    },
    manifest: {
      name: 'Hadeed',
      short_name: 'Hadeed',
      description: 'Training, nutrition and hydration tracking.',
      theme_color: '#131313',
      background_color: '#131313',
      // iOS only grants web push to a PWA launched from the home screen in standalone
      // display mode -- without this the install is a plain bookmark and
      // Notification.requestPermission() never resolves to 'granted'.
      display: 'standalone',
      start_url: '/',
      icons: [
        { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        // Separate maskable art: the mark is inset to ~72% so Android's adaptive-icon
        // crop can't clip the plates. Any purpose is fine on a square-mask launcher, but
        // a circular one would cut the standard icon's corners into the artwork.
        { src: '/pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    devOptions: {
      enabled: true,
      type: 'module',
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