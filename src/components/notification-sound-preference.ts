export const NOTIFICATION_SOUND_STORAGE_KEY = "compliancehub.notification-sound";
let sharedAudioContext: AudioContext | undefined;

function browserStorage(): Storage | undefined {
  try {
    const storage = typeof window === "undefined" ? undefined : window.localStorage;
    return storage && typeof storage.getItem === "function" ? storage : undefined;
  } catch {
    return undefined;
  }
}

export function notificationSoundEnabled(storage: Pick<Storage, "getItem"> | undefined = browserStorage()): boolean {
  try {
    return storage?.getItem(NOTIFICATION_SOUND_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function setNotificationSoundEnabled(
  enabled: boolean,
  storage: Pick<Storage, "setItem"> | undefined = browserStorage(),
): void {
  try {
    storage?.setItem(NOTIFICATION_SOUND_STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Sound stays off when the browser blocks local storage.
  }
}

export async function playNotificationTone(): Promise<void> {
  try {
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;
    const context = sharedAudioContext ??= new AudioContextClass();
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
