import { beforeEach, describe, expect, it } from "vitest";
import { notificationSoundEnabled, setNotificationSoundEnabled } from "./notification-sound-preference";

describe("notification sound preference", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };

  beforeEach(() => values.clear());

  it("is off until the person opts in", () => {
    expect(notificationSoundEnabled(storage)).toBe(false);
  });

  it("persists the explicit browser preference", () => {
    setNotificationSoundEnabled(true, storage);
    expect(notificationSoundEnabled(storage)).toBe(true);
    setNotificationSoundEnabled(false, storage);
    expect(notificationSoundEnabled(storage)).toBe(false);
  });

  it("keeps notifications usable when browser storage is blocked", () => {
    const blockedStorage = {
      getItem: () => { throw new DOMException("Blocked", "SecurityError"); },
      setItem: () => { throw new DOMException("Full", "QuotaExceededError"); },
    };

    expect(notificationSoundEnabled(blockedStorage)).toBe(false);
    expect(() => setNotificationSoundEnabled(true, blockedStorage)).not.toThrow();
  });
});
