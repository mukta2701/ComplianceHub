import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-slate-950 px-6 py-12 text-slate-100">
    <div className="mx-auto w-full max-w-md">
      <Link href="/" className="mb-10 block text-center text-2xl font-bold tracking-tight">Compliance<span className="text-blue-400">Hub</span></Link>
      {children}
    </div>
  </main>;
}
