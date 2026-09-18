// Two-tone chime via Web Audio API — no external audio asset needed, and
// works without a fresh user gesture since the admin has already interacted
// with the page by the time a poll cycle runs.
export function playNotifySound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const now = ctx.currentTime
    ;[880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const start = now + i * 0.15
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.3, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.3)
    })
  } catch {
    // Audio unavailable/blocked in this context — the toast still shows.
  }
}
