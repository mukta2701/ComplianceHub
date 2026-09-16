// The real `server-only` marker throws outside a React Server Component
// context, so the finite runner bundle replaces it with this inert stand-in:
// reconciliation runs in plain Node, not inside Next.js.
export {};
