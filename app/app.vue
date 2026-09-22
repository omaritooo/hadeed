<script setup lang="ts">
import { ConfigProvider } from "reka-ui";

// `seo: false` because `strategy: 'no_prefix'` gives every locale the same URL: the hreflang and
// canonical links `useLocaleHead` would otherwise emit would all point at that one href, which
// says nothing. Only the `<html>` attributes are wanted here.
const localeHead = useLocaleHead({ seo: false });

// `useLocaleHead` can also report "auto", which no locale in this app declares and which Reka's
// ConfigProvider doesn't accept -- anything that isn't explicitly RTL is treated as LTR.
const dir = computed(() => (localeHead.value.htmlAttrs.dir === "rtl" ? "rtl" : "ltr"));

useHead(() => ({
  htmlAttrs: { lang: localeHead.value.htmlAttrs.lang, dir: dir.value },
}));
</script>

<template>
  <!--
    ConfigProvider renders no element of its own; it only provides the direction that Reka's
    primitives read. Content the primitives teleport to <body> (drawers, popovers, combobox
    listboxes) still injects from here, because Teleport moves the DOM node without moving the
    component in the tree.
  -->
  <ConfigProvider :dir="dir">
    <NuxtLayout />
  </ConfigProvider>
</template>
