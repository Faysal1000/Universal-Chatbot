<script setup lang="ts">
import { ref } from 'vue';

import { demoWidgetAttributes } from '../demoConfig';

const attributes = demoWidgetAttributes();
const openCount = ref(0);
</script>

<template>
  <main class="site">
    <h1>Orion Lighthouse</h1>
    <p>A Vue page. Vue treats the tag as a custom element (see the demo's Vite config).</p>
    <p data-testid="open-count">Chat opened {{ openCount }} times</p>
    <universal-chat-bot v-bind="attributes" @chat-open="openCount++" />
  </main>
</template>
