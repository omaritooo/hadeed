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
    // The app has no "update available" prompt, so under the default 'prompt' a deploy only
    // reached a phone once every window of the installed app was closed. 'autoUpdate' reloads
    // onto the new build as soon as its service worker activates (see skipWaiting in sw.ts).
    registerType: 'autoUpdate',
    strategies: 'injectManifest',
    srcDir: '.',
    filename: 'sw.ts',
    injectManifest: {
      // The locale messages get a pattern of their own rather than widening the glob to every
      // `.json`. The only other JSON in `.output/public` is Nuxt's app manifest, which
      // @vite-pwa/nuxt already adds on its own terms -- it rewrites `latest.json`'s revision so a
      // deploy is still noticed -- and a blanket `json` would silently adopt whatever future
      // build step drops a JSON file in there.
      globPatterns: ['**/*.{js,css,html,png,svg,ico}', '_i18n/**/*.json'],
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

  i18n: {
    // No `/ar` URL prefix: the locale lives on the profile and in a cookie, so every
    // `navigateTo`/`NuxtLink` and the PWA `start_url` stay as they are.
    strategy: 'no_prefix',
    defaultLocale: 'en',
    // `file` resolves under `i18n/locales`, and each locale's messages are loaded on demand.
    locales: [
      { code: 'en', language: 'en', dir: 'ltr', file: 'en.json', name: 'English' },
      { code: 'ar', language: 'ar', dir: 'rtl', file: 'ar.json', name: 'العربية' },
    ],
    vueI18n: './i18n.config.ts',
    // Cookie first, then Accept-Language, so the login page -- which is rendered before there is
    // a profile to read a locale from -- is already in the visitor's language. The redirect
    // options (`redirectOn`, `alwaysRedirect`) are deliberately absent: they only gate localized
    // routes, and `no_prefix` has none.
    detectBrowserLanguage: { useCookie: true, cookieKey: 'i18n_locale', fallbackLocale: 'en' },
    experimental: {
      // v10 bundles the locale messages into the Nitro server and serves them on demand from
      // `/_i18n/<build-hash>/<locale>/messages.json`, so nothing lands in `.output/public` for the
      // service worker to precache. Prerendering that route emits it as a static file instead,
      // which the `_i18n/**/*.json` glob above then precaches -- so switching to Arabic works on a
      // phone that has never fetched Arabic while online. The URL carries the build hash, so a
      // deploy invalidates it for free.
      prerenderMessages: true,
    },
  },

  fonts: {
    families: [
      { name: 'Anybody', provider: 'google', weights: [600, 700, 800] },
      { name: 'Inter', provider: 'google', weights: [400, 500, 600, 700] },
      { name: 'JetBrains Mono', provider: 'google', weights: [700] },
      // Arabic faces. Two flags here are load-bearing, and both were verified against the built
      // CSS rather than assumed:
      //
      // `global` -- @nuxt/fonts resolves only the *first* family of each stack and treats the
      // rest as names to hang fallback metrics off, so the Arabic families, which sit after
      // Inter/Anybody in app/assets/css/index.css, are never downloaded on their own. `global`
      // emits their `@font-face` regardless of where they appear.
      //
      // `subsets` -- the default is Latin/Greek/Cyrillic/Vietnamese, and every other subset is
      // filtered out of Google's stylesheet, so without this the faces would carry no Arabic
      // glyphs at all. Arabic-only is also what keeps this free for English users: the emitted
      // `unicode-range` covers Arabic alone, so the browser fetches these files only once Arabic
      // text is on screen, and @nuxt/fonts skips preloading a subsetted face.
      { name: 'IBM Plex Sans Arabic', provider: 'google', weights: [400, 500, 600, 700], subsets: ['arabic'], global: true },
      { name: 'Noto Kufi Arabic', provider: 'google', weights: [600, 700, 800], subsets: ['arabic'], global: true },
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