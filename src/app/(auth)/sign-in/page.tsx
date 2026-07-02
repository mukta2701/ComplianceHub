import Link from "next/link";
import { signInAction } from "../actions";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const { message } = await searchParams;
  return <section className="rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-xl">
    <h1 className="text-2xl font-semibold">Sign in</h1><p className="mt-2 text-sm text-slate-400">Continue your ISO 27001 readiness work.</p>
    {message && <p role="status" className="mt-5 rounded-lg bg-blue-950 p-3 text-sm text-blue-200">{message}</p>}
    <form action={signInAction} className="mt-6 space-y-5">
      <label className="block text-sm">Email<input name="email" type="email" autoComplete="email" required className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" /></label>
      <label className="block text-sm">Password<input name="password" type="password" autoComplete="current-password" minLength={10} required className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" /></label>
      <button className="w-full rounded-lg bg-blue-600 px-4 py-2.5 font-semibold hover:bg-blue-500">Sign in</button>
    </form>
    <p className="mt-6 text-center text-sm text-slate-400">New to ComplianceHub? <Link className="text-blue-400" href="/sign-up">Create an account</Link></p>
  </section>;
}
