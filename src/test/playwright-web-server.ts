export function playwrightWebServerCommand(input: { ci: boolean; port: number }): string {
  const script = input.ci ? "start" : "dev";
  return `npm run ${script} -- --port ${input.port}`;
}
