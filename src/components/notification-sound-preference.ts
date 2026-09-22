let sharedAudioContext: AudioContext | undefined;

function audioContext(): AudioContext | undefined {
  try {
    if (typeof window === "undefined" || !window.AudioContext) return undefined;
    return sharedAudioContext ??= new window.AudioContext();
  } catch {
    return undefined;
  }
}

export async function prepareNotificationTone(): Promise<void> {
  try {
    const context = audioContext();
    if (context?.state === "suspended") await context.resume();
  } catch {
    // Browser audio policy can still block preparation; notifications remain usable.
  }
}

export async function playNotificationTone(): Promise<void> {
  try {
    const context = audioContext();
    if (!context) return;
    if (context.state === "suspended") await context.resume();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.2);
  } catch {
    // Browser audio policy may block background playback; notifications still render.
  }
}
