import { createOrganisationAction } from "../actions";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const { message } = await searchParams;
  return <main className="mx-auto max-w-xl px-6 py-16">
    <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">Workspace setup</p>
    <h1 className="mt-2 text-3xl font-bold">Create your organisation</h1>
    <p className="mt-3 text-slate-600">Assessment answers, risks and exports are isolated to this organisation.</p>
    {message && <p role="alert" className="mt-6 rounded-lg bg-red-50 p-3 text-sm text-red-800">{message}</p>}
    <form action={createOrganisationAction} className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <label className="block font-medium">Organisation name<input name="name" required maxLength={160} autoFocus className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5" placeholder="Example Ltd" /></label>
      <button className="mt-6 rounded-lg bg-blue-600 px-5 py-2.5 font-semibold text-white hover:bg-blue-700">Create workspace</button>
    </form>
  </main>;
}
