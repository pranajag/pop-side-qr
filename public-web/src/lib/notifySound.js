// Three-note ascending chime via Web Audio API — no external audio asset
// needed. Distinct from admin-web's own two-tone alert (that's a staff
// "something needs attention" cue; this is a customer "good news" cue) but
// built the same way, for the same reason: works without a fresh user
// gesture since the customer already interacted with the page (uploaded
// bukti bayar, or just opened it) by the time a status poll lands.
export function playReadySound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const now = ctx.currentTime
    ;[660, 880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const start = now + i * 0.12
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.35, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.35)
    })
  } catch {
    // Audio unavailable/blocked in this context — the visual cue still shows.
  }
}
