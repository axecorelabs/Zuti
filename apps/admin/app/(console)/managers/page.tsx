'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { BriefcaseBusiness, Building2, Crown, Search, ShieldCheck, X } from 'lucide-react';
import { adminApi } from '@/lib/api';

type ManagerItem = {
	id: string;
	name: string | null;
	email: string;
	role: 'USER' | 'MANAGER';
	createdAt: string;
	memberships: Array<{
		id: string;
		role: 'OWNER' | 'ADMIN' | 'AGENT';
		organization: {
			id: string;
			name: string;
			slug: string;
		};
	}>;
};

function formatDate(value: string) {
	return new Date(value).toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	});
}

function getInitials(item: ManagerItem) {
	return (item.name || item.email).slice(0, 1).toUpperCase();
}

function rolePillClass(role: 'OWNER' | 'ADMIN' | 'AGENT') {
	if (role === 'OWNER') return 'border-blue-500/30 bg-blue-500/10 text-blue-200';
	if (role === 'ADMIN') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
	return 'border-zinc-700 bg-zinc-900/70 text-zinc-400';
}

function roleLabel(role: 'OWNER' | 'ADMIN' | 'AGENT') {
	if (role === 'OWNER') return 'Owner';
	if (role === 'ADMIN') return 'Admin';
	return 'Agent';
}

export default function ManagersPage() {
	const [loading, setLoading] = useState(true);
	const [portalReady, setPortalReady] = useState(false);
	const [query, setQuery] = useState('');
	const [items, setItems] = useState<ManagerItem[]>([]);
	const [selectedManagerId, setSelectedManagerId] = useState<string | null>(null);
	const [drawerOpen, setDrawerOpen] = useState(false);

	useEffect(() => {
		setPortalReady(true);
	}, []);

	useEffect(() => {
		let mounted = true;

		async function load() {
			try {
				const res = await adminApi.listUsers({ limit: 500 });
				if (!mounted) return;
				const users = Array.isArray(res.data?.items) ? (res.data.items as ManagerItem[]) : [];
				const managers = users.filter((item) => item.role === 'MANAGER');
				setItems(managers);
				setSelectedManagerId(managers[0]?.id ?? null);
			} finally {
				if (mounted) setLoading(false);
			}
		}

		load();

		return () => {
			mounted = false;
		};
	}, []);

	const filteredItems = useMemo(() => {
		const normalizedQuery = query.trim().toLowerCase();
		if (!normalizedQuery) return items;

		return items.filter((item) => {
			const controlsWorkspace = item.memberships.some((membership) => membership.role === 'OWNER' || membership.role === 'ADMIN');
			const inChargeNames = item.memberships
				.filter((membership) => membership.role === 'OWNER' || membership.role === 'ADMIN')
				.map((membership) => membership.organization.name.toLowerCase());

			return (item.name ?? '').toLowerCase().includes(normalizedQuery)
				|| item.email.toLowerCase().includes(normalizedQuery)
				|| inChargeNames.some((name) => name.includes(normalizedQuery))
				|| (normalizedQuery === 'in charge' && controlsWorkspace);
		});
	}, [items, query]);

	const selectedManager = filteredItems.find((item) => item.id === selectedManagerId)
		?? items.find((item) => item.id === selectedManagerId)
		?? filteredItems[0]
		?? items[0]
		?? null;

	const stats = useMemo(() => {
		const inChargeMemberships = items.flatMap((item) =>
			item.memberships.filter((membership) => membership.role === 'OWNER' || membership.role === 'ADMIN'));
		const uniqueInChargeWorkspaceIds = new Set(inChargeMemberships.map((membership) => membership.organization.id));
		const ownerSeats = inChargeMemberships.filter((membership) => membership.role === 'OWNER').length;
		const adminSeats = inChargeMemberships.filter((membership) => membership.role === 'ADMIN').length;

		return {
			managers: items.length,
			workspacesInCharge: uniqueInChargeWorkspaceIds.size,
			ownerSeats,
			adminSeats,
		};
	}, [items]);

	const openManager = (id: string) => {
		setSelectedManagerId(id);
		setDrawerOpen(true);
	};

	const closeDrawer = () => setDrawerOpen(false);

	const managerDetails = selectedManager
		? {
				inCharge: selectedManager.memberships.filter((membership) => membership.role === 'OWNER' || membership.role === 'ADMIN'),
				allMemberships: selectedManager.memberships,
			}
		: { inCharge: [], allMemberships: [] };

	const drawerPanel = (
		<>
			<div
				style={{ top: 0, bottom: 0, height: '100dvh' }}
				className={`fixed right-0 z-50 flex w-full max-w-[24rem] transform flex-col border-l border-zinc-900 bg-zinc-950 shadow-2xl transition-transform duration-200 ease-out ${
					drawerOpen ? 'translate-x-0' : 'translate-x-full'
				}`}
			>
				<div className="flex items-start justify-between border-b border-zinc-900 px-4 py-4">
					<div>
						<p className="text-[10px] uppercase tracking-[0.24em] text-zinc-600">Manager details</p>
						<h3 className="mt-1 font-brand text-base text-white">Workspace responsibilities</h3>
					</div>
					<button
						type="button"
						onClick={closeDrawer}
						className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
						aria-label="Close drawer"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				{!selectedManager ? (
					<div className="flex flex-1 items-center justify-center p-6 text-sm text-zinc-500">
						Select a manager to inspect details.
					</div>
				) : (
					<div className="flex flex-1 flex-col">
						<div className="border-b border-zinc-900 px-4 py-4">
							<div className="flex items-start gap-3">
								<div className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-sm text-zinc-300">
									{getInitials(selectedManager)}
								</div>
								<div className="min-w-0">
									<h4 className="truncate text-sm text-white">{selectedManager.name || 'Unnamed manager'}</h4>
									<p className="mt-0.5 truncate text-xs text-zinc-500">{selectedManager.email}</p>
									<p className="mt-1 text-xs text-zinc-600">Joined {formatDate(selectedManager.createdAt)}</p>
								</div>
							</div>
						</div>

						<div className="border-b border-zinc-900 px-4 py-4">
							<div className="mb-2 flex items-center gap-2 text-zinc-500">
								<Crown className="h-3.5 w-3.5" />
								<p className="text-[10px] uppercase tracking-[0.18em]">In-charge workspaces</p>
							</div>
							<div className="space-y-2">
								{managerDetails.inCharge.length === 0 ? (
									<div className="rounded-xl border border-dashed border-zinc-800 px-3 py-3 text-xs text-zinc-500">
										No owner/admin responsibility in any workspace.
									</div>
								) : (
									managerDetails.inCharge.map((membership) => (
										<div key={membership.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
											<div className="flex items-start justify-between gap-3">
												<div className="min-w-0">
													<p className="truncate text-sm text-white">{membership.organization.name}</p>
													<p className="mt-0.5 truncate text-xs text-zinc-600">/{membership.organization.slug}</p>
												</div>
												<span className={`inline-flex h-6 items-center justify-center rounded-full border px-2.5 text-[11px] ${rolePillClass(membership.role)}`}>
													{roleLabel(membership.role)}
												</span>
											</div>
										</div>
									))
								)}
							</div>
						</div>

						<div className="flex-1 px-4 py-4">
							<div className="mb-2 flex items-center gap-2 text-zinc-500">
								<Building2 className="h-3.5 w-3.5" />
								<p className="text-[10px] uppercase tracking-[0.18em]">All memberships</p>
							</div>
							<div className="space-y-2">
								{managerDetails.allMemberships.length === 0 ? (
									<div className="rounded-xl border border-dashed border-zinc-800 px-3 py-3 text-xs text-zinc-500">
										No workspace memberships.
									</div>
								) : (
									managerDetails.allMemberships.map((membership) => (
										<div key={membership.id} className="rounded-xl border border-zinc-900 bg-zinc-900/35 px-3 py-2.5">
											<div className="flex items-start justify-between gap-3">
												<div className="min-w-0">
													<p className="truncate text-sm text-white">{membership.organization.name}</p>
													<p className="mt-0.5 truncate text-xs text-zinc-600">/{membership.organization.slug}</p>
												</div>
												<span className={`inline-flex h-6 items-center justify-center rounded-full border px-2.5 text-[11px] ${rolePillClass(membership.role)}`}>
													{roleLabel(membership.role)}
												</span>
											</div>
										</div>
									))
								)}
							</div>
						</div>
					</div>
				)}
			</div>

			{drawerOpen ? (
				<button
					type="button"
					aria-label="Close manager details overlay"
					onClick={closeDrawer}
					style={{ top: 0, bottom: 0, height: '100dvh' }}
					className="fixed inset-x-0 z-40 bg-black/50 backdrop-blur-[1px]"
				/>
			) : null}
		</>
	);

	return (
		<div className="space-y-6 p-4 md:p-8">
			<div>
				<h1 className="font-brand text-2xl font-semibold tracking-tight text-white">Manager management</h1>
				<p className="mt-1 text-sm font-light text-zinc-500">
					Inspect platform managers and quickly see which workspaces they are responsible for.
				</p>
			</div>

			<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
				<div className="card p-5">
					<p className="text-xs text-zinc-500">Managers</p>
					<p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">{stats.managers}</p>
				</div>
				<div className="card p-5">
					<p className="text-xs text-zinc-500">Workspaces in charge</p>
					<p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">{stats.workspacesInCharge}</p>
				</div>
				<div className="card p-5">
					<p className="text-xs text-zinc-500">Owner seats</p>
					<p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">{stats.ownerSeats}</p>
				</div>
				<div className="card p-5">
					<p className="text-xs text-zinc-500">Admin seats</p>
					<p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">{stats.adminSeats}</p>
				</div>
			</div>

			<div className="card overflow-hidden">
				<div className="border-b border-zinc-800 px-5 py-5 md:px-6">
					<div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
						<div>
							<h2 className="font-brand text-xl text-white">
								All managers <span className="text-zinc-500">{filteredItems.length}</span>
							</h2>
							<p className="mt-1 text-sm text-zinc-500">
								Search by manager or workspace name and open detailed ownership responsibility in the right drawer.
							</p>
						</div>

						<label className="relative block sm:min-w-[320px]">
							<Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
							<input
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								placeholder="Search managers or workspaces"
								className="input-base h-11 rounded-2xl border-zinc-700/80 bg-zinc-900/80 pl-11"
							/>
						</label>
					</div>
				</div>

				{loading ? (
					<div className="space-y-3 p-4 md:p-6">
						{[...Array(6)].map((_, index) => (
							<div key={index} className="h-20 rounded-2xl bg-zinc-900 animate-pulse" />
						))}
					</div>
				) : filteredItems.length === 0 ? (
					<div className="p-10 text-center">
						<p className="text-sm text-zinc-400">No managers match the current search.</p>
						<p className="mt-1 text-xs text-zinc-600">Try searching by a different workspace or manager name.</p>
					</div>
				) : (
					<div>
						<div className="hidden grid-cols-[minmax(0,1.2fr)_120px_120px_140px_30px] gap-4 border-b border-zinc-800/80 px-6 py-3 text-[11px] uppercase tracking-[0.22em] text-zinc-600 md:grid">
							<span>Manager</span>
							<span>In charge</span>
							<span>Workspaces</span>
							<span>Joined</span>
							<span />
						</div>

						<div className="divide-y divide-zinc-800/60">
							{filteredItems.map((item) => {
								const inChargeCount = item.memberships.filter((membership) => membership.role === 'OWNER' || membership.role === 'ADMIN').length;

								return (
									<button
										key={item.id}
										type="button"
										onClick={() => openManager(item.id)}
										className="group grid w-full gap-3 px-4 py-4 text-left transition-colors hover:bg-zinc-900/40 md:grid-cols-[minmax(0,1.2fr)_120px_120px_140px_30px] md:px-6"
									>
										<div className="flex min-w-0 items-center gap-3">
											<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-sm text-zinc-300">
												{getInitials(item)}
											</div>
											<div className="min-w-0">
												<p className="truncate text-sm text-white group-hover:text-zinc-100">{item.name || 'Unnamed manager'}</p>
												<p className="mt-0.5 truncate text-xs text-zinc-500">{item.email}</p>
											</div>
										</div>

										<div className="text-sm text-zinc-300">{inChargeCount}</div>
										<div className="text-sm text-zinc-300">{item.memberships.length}</div>
										<div className="text-sm text-zinc-400">{formatDate(item.createdAt)}</div>
										<div className="self-center text-right text-zinc-600 group-hover:text-zinc-300">→</div>

										<div className="md:col-span-5">
											<div className="flex flex-wrap gap-1.5">
												{item.memberships
													.filter((membership) => membership.role === 'OWNER' || membership.role === 'ADMIN')
													.slice(0, 4)
													.map((membership) => (
														<span key={membership.id} className={`inline-flex h-6 items-center justify-center rounded-full border px-2.5 text-[11px] ${rolePillClass(membership.role)}`}>
															{membership.organization.name} · {roleLabel(membership.role)}
														</span>
													))}
												{inChargeCount === 0 ? (
													<span className="inline-flex h-6 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/50 px-2.5 text-[11px] text-zinc-500">
														No owner/admin responsibility
													</span>
												) : null}
												{inChargeCount > 4 ? (
													<span className="inline-flex h-6 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/50 px-2.5 text-[11px] text-zinc-500">
														+{inChargeCount - 4} more
													</span>
												) : null}
											</div>
										</div>
									</button>
								);
							})}
						</div>
					</div>
				)}
			</div>

			{portalReady ? createPortal(drawerPanel, document.body) : null}
		</div>
	);
}