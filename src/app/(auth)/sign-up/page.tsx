import Link from "next/link";
import { signUpAction } from "../actions";

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const { message } = await searchParams;
  return <section className="rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-xl">
    <h1 className="text-2xl font-semibold">Create your account</h1><p className="mt-2 text-sm text-slate-400">Start a private readiness workspace for your organisation.</p>
    {message && <p role="alert" className="mt-5 rounded-lg bg-red-950 p-3 text-sm text-red-200">{message}</p>}
    <form action={signUpAction} className="mt-6 space-y-4">
      <label className="block text-sm">Name<input name="displayName" autoComplete="name" maxLength={120} required className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" /></label>
      <label className="block text-sm">Email<input name="email" type="email" autoComplete="email" required className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" /></label>
      <label className="block text-sm">Password<input name="password" type="password" autoComplete="new-password" minLength={10} required className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" /></label>
      <label className="block text-sm">Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={10} required className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" /></label>
      <button className="w-full rounded-lg bg-blue-600 px-4 py-2.5 font-semibold hover:bg-blue-500">Create account</button>
    </form>
    <p className="mt-6 text-center text-sm text-slate-400">Already registered? <Link className="text-blue-400" href="/sign-in">Sign in</Link></p>
  </section>;
}
