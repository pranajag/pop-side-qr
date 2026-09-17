<script setup>
import { Toaster } from '@/components/ui/sonner'
</script>

<template>
  <router-view />
  <Toaster position="top-right" rich-colors close-button />
</template>
