import Link from 'next/link';

type CreditPack = {
  name: string;
  credits: number;
  amount: string;
};

const ngPacks: CreditPack[] = [
  { name: 'Mini', credits: 200, amount: 'N2,000' },
  { name: 'Starter', credits: 500, amount: 'N5,000' },
  { name: 'Growth', credits: 1_000, amount: 'N10,000' },
  { name: 'Pro', credits: 6_000, amount: 'N54,000' },
];

const usPacks: CreditPack[] = [
  { name: 'Starter', credits: 1_000, amount: '$12' },
  { name: 'Growth', credits: 10_000, amount: '$100' },
  { name: 'Scale', credits: 50_000, amount: '$450' },
];

function Table({ title, rows }: { title: string; rows: CreditPack[] }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
      <h3 className="text-sm text-zinc-100 mb-4">{title}</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-zinc-500 border-b border-zinc-800">
            <th className="py-2 pr-4 font-normal">Pack</th>
            <th className="py-2 pr-4 font-normal">Credits</th>
            <th className="py-2 pr-4 font-normal">One-time top-up</th>
            <th className="py-2 font-normal">Monthly commitment</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} className="border-b border-zinc-900/70">
              <td className="py-2 pr-4 text-zinc-200">{row.name}</td>
              <td className="py-2 pr-4 text-zinc-400">{row.credits.toLocaleString()}</td>
              <td className="py-2 pr-4 text-zinc-300">{row.amount}</td>
              <td className="py-2 text-zinc-300">{row.amount} / month</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-black text-white px-4 sm:px-6 md:px-10 py-10 md:py-14">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-8">
          <div>
            <p className="text-[11px] uppercase tracking-[0.28em] text-zinc-500">Pricing</p>
            <h1 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight">Credits + Commitments</h1>
            <p className="mt-3 text-sm text-zinc-400 max-w-2xl">
              Same credit packs, two ways to buy: one-time top-up or a monthly auto-renew commitment.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login" className="px-4 py-2 rounded-full border border-zinc-700 text-zinc-300 hover:text-white hover:bg-zinc-900 text-sm">
              Sign in
            </Link>
            <Link href="/register" className="px-4 py-2 rounded-full bg-white text-black hover:bg-zinc-100 text-sm">
              Start free
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <Table title="Nigeria (NGN) Credit Packs" rows={ngPacks} />
          <Table title="US / Global (USD) Credit Packs" rows={usPacks} />
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
          <h3 className="text-sm text-zinc-100 mb-2">How commitments work</h3>
          <p className="text-sm text-zinc-400">
            A commitment is the same pack set to renew every month. If you pick a one-time top-up, it charges once.
            If you pick a commitment, it auto-renews monthly for the same amount and credits.
          </p>
          <p className="text-xs text-zinc-500 mt-3">
            First organization still receives the free starter credits; additional organizations require paid credits.
          </p>
        </div>
      </div>
    </main>
  );
}
