export function isDestructiveIntegrationTargetAllowed(
  rawUrl: string | undefined,
): boolean {
  if (!rawUrl) return false;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}
