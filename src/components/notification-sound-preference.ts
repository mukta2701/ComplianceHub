export const NOTIFICATION_SOUND_STORAGE_KEY = "compliancehub.notification-sound";

function browserStorage(): Storage | undefined {
  const storage = typeof window === "undefined" ? undefined : window.localStorage;
  return storage && typeof storage.getItem === "function" ? storage : undefined;
}

export function notificationSoundEnabled(storage: Pick<Storage, "getItem"> | undefined = browserStorage()): boolean {
  return storage?.getItem(NOTIFICATION_SOUND_STORAGE_KEY) === "on";
}

export function setNotificationSoundEnabled(
  enabled: boolean,
  storage: Pick<Storage, "setItem"> | undefined = browserStorage(),
): void {
  storage?.setItem(NOTIFICATION_SOUND_STORAGE_KEY, enabled ? "on" : "off");
}

export async function playNotificationTone(): Promise<void> {
  try {
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
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
    oscillator.addEventListener("ended", () => void context.close(), { once: true });
  } catch {
    // Browser audio policy may block background playback; notifications still render.
  }
}
