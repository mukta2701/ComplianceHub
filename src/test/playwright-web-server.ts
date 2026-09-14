export function playwrightPort(environment: Readonly<Record<string, string | undefined>>): number {
  return Number(environment.PLAYWRIGHT_PORT ?? 3100);
}

export function playwrightWebServerCommand(input: { ci: boolean; port: number }): string {
  if (input.ci) return `bash scripts/playwright-production-server.sh ${input.port}`;
  return `npm run dev -- --port ${input.port}`;
}

export function playwrightWorkerCount(input: { ci: boolean }): number | undefined {
  return input.ci ? 1 : 1;
}
