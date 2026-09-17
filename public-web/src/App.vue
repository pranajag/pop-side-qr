<script setup>
import { Toaster } from '@/components/ui/sonner'
</script>

<template>
  <router-view />
  <Toaster position="top-center" rich-colors close-button />
</template>
