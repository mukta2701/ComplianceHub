import { beforeEach, describe, expect, it, vi } from "vitest";
import { playNotificationTone, prepareNotificationTone } from "./notification-sound-preference";

describe("automatic notification sound", () => {
  const resume = vi.fn();
  const start = vi.fn();
  const stop = vi.fn();
  const connect = vi.fn();
  const setValueAtTime = vi.fn();
  const exponentialRampToValueAtTime = vi.fn();
  const context = {
    state: "suspended",
    currentTime: 10,
    destination: {},
    resume,
    createOscillator: vi.fn(() => ({ frequency: { value: 0 }, connect, start, stop })),
    createGain: vi.fn(() => ({ gain: { setValueAtTime, exponentialRampToValueAtTime }, connect })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    class TestAudioContext {
      constructor() { return context; }
    }
    vi.stubGlobal("AudioContext", TestAudioContext);
  });

  it("prepares browser audio without making a sound", async () => {
    await prepareNotificationTone();

    expect(resume).toHaveBeenCalledOnce();
    expect(context.createOscillator).not.toHaveBeenCalled();
  });

  it("plays the built-in tone after preparation", async () => {
    await prepareNotificationTone();
    context.state = "running";
    await playNotificationTone();

    expect(start).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledWith(10.2);
  });
});
