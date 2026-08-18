export function playwrightWebServerCommand(input: { ci: boolean; port: number }): string {
  if (input.ci) return `bash scripts/playwright-production-server.sh ${input.port}`;
  return `npm run dev -- --port ${input.port}`;
}

export function playwrightWorkerCount(input: { ci: boolean }): number | undefined {
  return input.ci ? 2 : 1;
}
