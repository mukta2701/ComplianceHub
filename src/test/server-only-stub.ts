// `server-only` is a compile-time marker Next.js resolves itself; it is not an
// installed package, so vitest needs this inert stand-in to import modules
// that guard themselves with it.
export {};
