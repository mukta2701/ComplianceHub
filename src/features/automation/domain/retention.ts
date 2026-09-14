export function shouldPurgeSourceObject({ status, expiresAt }: { status: string; expiresAt: string }, now = new Date()): boolean {
  return status === "pending" && new Date(expiresAt).getTime() <= now.getTime();
}

export function purgeContentReference(contentHash: string): string {
  return `purged://${contentHash}`;
}
