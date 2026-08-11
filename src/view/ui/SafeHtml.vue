<!--
  SafeHtml: renders a trusted HTML string via v-html.

  This component exists to isolate `v-html` usage to a single file so the
  rest of the codebase can satisfy the `vue/no-v-html` lint rule.  It is
  ONLY for trusted, internally-generated SVG/HTML strings (icon glyphs,
  keyboard shortcut glyphs) — never user input.
-->
<script setup lang="ts">
withDefaults(defineProps<{ html?: string }>(), { html: '' });
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <span v-html="html" />
</template>
