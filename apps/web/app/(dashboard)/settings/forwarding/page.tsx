'use client';

import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2, Save, Link2 } from 'lucide-react';
import { botsApi, orgsApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

interface Org {
  id: string;
  name: string;
  members?: Array<{ role: string }>;
}

interface ContactEndpoint {
  id: string;
  label: string;
  channel: 'TELEGRAM' | 'EMAIL';
  destination: string;
  isActive: boolean;
  isPrimary: boolean;
}

interface ContactPolicy {
  id: string;
  name: string;
  scope: 'ORGANIZATION' | 'BOT';
  endpointId?: string | null;
  botId?: string | null;
  isDefault: boolean;
}

interface BotItem {
  id: string;
  name: string;
}

export default function ForwardingSettingsPage() {
  const { activeOrgId, setActiveOrgId, getRoleForOrg } = useAuthStore();
  const [org, setOrg] = useState<Org | null>(null);
  const [bots, setBots] = useState<BotItem[]>([]);
  const [endpoints, setEndpoints] = useState<ContactEndpoint[]>([]);
  const [policies, setPolicies] = useState<ContactPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [newEndpoint, setNewEndpoint] = useState({
    label: '',
    channel: 'EMAIL' as 'EMAIL' | 'TELEGRAM',
    destination: '',
    isPrimary: false,
  });

  const activeRole = org ? (org.members?.[0]?.role ?? getRoleForOrg(org.id) ?? 'AGENT') : 'AGENT';
  const isOwner = activeRole === 'OWNER';
  const isReadOnly = !isOwner;

  const orgDefaultPolicy = useMemo(
    () => policies.find((p) => p.scope === 'ORGANIZATION' && p.isDefault),
    [policies],
  );

  const [defaultEndpointId, setDefaultEndpointId] = useState<string>('');

  async function loadData(selectedOrgId: string) {
    setLoading(true);
    try {
      const [endpointsRes, policiesRes, botsRes] = await Promise.all([
        orgsApi.listContactEndpoints(selectedOrgId),
        orgsApi.listContactPolicies(selectedOrgId),
        botsApi.list(selectedOrgId),
      ]);
      setEndpoints(endpointsRes.data ?? []);
      setPolicies(policiesRes.data ?? []);
      setBots((botsRes.data ?? []).map((b: BotItem) => ({ id: b.id, name: b.name })));
      const currentDefault = (policiesRes.data ?? []).find((p: ContactPolicy) => p.scope === 'ORGANIZATION' && p.isDefault);
      setDefaultEndpointId(currentDefault?.endpointId ?? '');
    } catch {
      toast.error('Failed to load forwarding settings');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    orgsApi
      .list()
      .then((res) => {
        const orgs = (res.data ?? []) as Org[];
        const preferred = (activeOrgId && orgs.find((currentOrg) => currentOrg.id === activeOrgId)) ?? orgs[0];
        if (!preferred) {
          setLoading(false);
          return;
        }
        setOrg(preferred);
        if (preferred.id !== activeOrgId) {
          setActiveOrgId(preferred.id);
        }
        const role = preferred.members?.[0]?.role ?? getRoleForOrg(preferred.id) ?? 'AGENT';
        if (role !== 'OWNER') {
          setLoading(false);
          return;
        }
        loadData(preferred.id);
      })
      .catch(() => setLoading(false));
  }, [activeOrgId, getRoleForOrg, setActiveOrgId]);

  const handleCreateEndpoint = async () => {
    if (!org) return;
    if (!newEndpoint.label.trim() || !newEndpoint.destination.trim()) {
      toast.error('Label and destination are required');
      return;
    }
    setSaving(true);
    try {
      await orgsApi.createContactEndpoint(org.id, {
        label: newEndpoint.label.trim(),
        channel: newEndpoint.channel,
        destination: newEndpoint.destination.trim(),
        isPrimary: newEndpoint.isPrimary,
      });
      setNewEndpoint({ label: '', channel: 'EMAIL', destination: '', isPrimary: false });
      await loadData(org.id);
      toast.success('Endpoint created');
    } catch {
      toast.error('Failed to create endpoint');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEndpoint = async (endpoint: ContactEndpoint, patch: Partial<ContactEndpoint>) => {
    if (!org) return;
    try {
      await orgsApi.updateContactEndpoint(org.id, endpoint.id, patch);
      setEndpoints((prev) => prev.map((ep) => (ep.id === endpoint.id ? { ...ep, ...patch } : ep)));
    } catch {
      toast.error('Failed to update endpoint');
    }
  };

  const handleDeleteEndpoint = async (endpointId: string) => {
    if (!org) return;
    if (!confirm('Delete this endpoint?')) return;
    try {
      await orgsApi.deleteContactEndpoint(org.id, endpointId);
      setEndpoints((prev) => prev.filter((ep) => ep.id !== endpointId));
      toast.success('Endpoint deleted');
    } catch {
      toast.error('Failed to delete endpoint');
    }
  };

  const handleSaveDefaultPolicy = async () => {
    if (!org) return;
    if (!defaultEndpointId) {
      toast.error('Choose a default endpoint first');
      return;
    }
    setSaving(true);
    try {
      if (orgDefaultPolicy) {
        await orgsApi.updateContactPolicy(org.id, orgDefaultPolicy.id, {
          endpointId: defaultEndpointId,
          isDefault: true,
          name: orgDefaultPolicy.name || 'Default forwarding policy',
        });
      } else {
        await orgsApi.createContactPolicy(org.id, {
          name: 'Default forwarding policy',
          scope: 'ORGANIZATION',
          endpointId: defaultEndpointId,
          isDefault: true,
        });
      }
      await loadData(org.id);
      toast.success('Default forwarding policy saved');
    } catch {
      toast.error('Failed to save default policy');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="settings-page settings-forwarding-page p-4 md:p-8">
        <div className="mb-8 space-y-2">
          <div className="h-8 w-56 rounded-xl bg-zinc-900 animate-pulse" />
          <div className="h-4 w-96 max-w-full rounded-lg bg-zinc-900 animate-pulse" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="card p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="h-4 w-36 rounded bg-zinc-900 animate-pulse" />
              <div className="h-3 w-20 rounded bg-zinc-900 animate-pulse" />
            </div>

            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="rounded-lg border border-zinc-800 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="space-y-2">
                      <div className="h-4 w-32 rounded bg-zinc-900 animate-pulse" />
                      <div className="h-3 w-48 rounded bg-zinc-900 animate-pulse" />
                    </div>
                    <div className="h-7 w-16 rounded border border-zinc-800 bg-zinc-900 animate-pulse" />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-lg border border-zinc-800 p-3 space-y-2">
              <div className="h-3 w-24 rounded bg-zinc-900 animate-pulse" />
              <div className="h-9 w-full rounded-lg bg-zinc-900 animate-pulse" />
              <div className="grid grid-cols-2 gap-2">
                <div className="h-9 rounded-lg bg-zinc-900 animate-pulse" />
                <div className="h-9 rounded-lg bg-zinc-900 animate-pulse" />
              </div>
              <div className="h-9 w-36 rounded-lg bg-zinc-900 animate-pulse" />
            </div>
          </section>

          <section className="card p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="h-4 w-40 rounded bg-zinc-900 animate-pulse" />
              <div className="h-4 w-4 rounded bg-zinc-900 animate-pulse" />
            </div>
            <div className="h-3 w-72 max-w-full rounded bg-zinc-900 animate-pulse mb-3" />
            <div className="h-9 w-full rounded-lg bg-zinc-900 animate-pulse" />
            <div className="h-9 w-44 rounded-lg bg-zinc-900 animate-pulse mt-3" />

            <div className="mt-5 rounded-lg border border-zinc-800 p-3 space-y-2">
              <div className="h-3 w-24 rounded bg-zinc-900 animate-pulse" />
              {[...Array(2)].map((_, i) => (
                <div key={i} className="h-8 rounded border border-zinc-800 bg-zinc-900 animate-pulse" />
              ))}
            </div>
          </section>
        </div>
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="settings-page settings-forwarding-page p-4 md:p-8">
        <div className="card p-6 max-w-2xl">
          <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">Forwarding Settings</h1>
          <p className="mt-2 text-sm text-zinc-400">Only the workspace owner can access forwarding settings.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page settings-forwarding-page p-4 md:p-8">
      <div className="mb-8">
        <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">Forwarding Settings</h1>
        <p className="mt-1 text-sm text-zinc-500 font-light">
          Configure forwarding destinations and the organization default route.
        </p>
      </div>

      {isReadOnly && (
        <div className="mb-6 rounded-xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-sm text-orange-300">
          Only the workspace owner can modify forwarding settings.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm text-white font-medium">Contact Endpoints</h2>
            <span className="text-xs text-zinc-500">{endpoints.length} endpoints</span>
          </div>

          <div className="space-y-2">
            {endpoints.map((endpoint) => (
              <div key={endpoint.id} className="rounded-lg border border-zinc-800 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm text-zinc-100">{endpoint.label}</p>
                    <p className="text-xs text-zinc-500">{endpoint.channel} · {endpoint.destination}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      disabled={isReadOnly}
                      onClick={() => handleToggleEndpoint(endpoint, { isActive: !endpoint.isActive })}
                      className={`text-[11px] px-2 py-1 rounded border ${
                        endpoint.isActive ? 'border-emerald-500/30 text-emerald-400' : 'border-zinc-700 text-zinc-500'
                      } disabled:opacity-50`}
                    >
                      {endpoint.isActive ? 'Active' : 'Inactive'}
                    </button>
                    <button
                      disabled={isReadOnly}
                      onClick={() => handleDeleteEndpoint(endpoint.id)}
                      className="text-zinc-500 hover:text-red-400 disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {endpoints.length === 0 && (
              <div className="rounded-lg border border-zinc-800 p-4 text-xs text-zinc-500">No endpoints yet.</div>
            )}
          </div>

          <div className="mt-4 rounded-lg border border-zinc-800 p-3 space-y-2">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Add endpoint</p>
            <input
              disabled={isReadOnly}
              value={newEndpoint.label}
              onChange={(e) => setNewEndpoint((prev) => ({ ...prev, label: e.target.value }))}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
              placeholder="Label (e.g. Owner Email)"
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                disabled={isReadOnly}
                value={newEndpoint.channel}
                onChange={(e) => setNewEndpoint((prev) => ({ ...prev, channel: e.target.value as 'EMAIL' | 'TELEGRAM' }))}
                className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
              >
                <option value="EMAIL">EMAIL</option>
                <option value="TELEGRAM">TELEGRAM</option>
              </select>
              <input
                disabled={isReadOnly}
                value={newEndpoint.destination}
                onChange={(e) => setNewEndpoint((prev) => ({ ...prev, destination: e.target.value }))}
                className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
                placeholder="Destination"
              />
            </div>
            <button
              disabled={isReadOnly || saving}
              onClick={handleCreateEndpoint}
              className="inline-flex items-center gap-2 rounded-lg bg-zinc-200 px-3 py-2 text-sm text-zinc-900 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" /> Add Endpoint
            </button>
          </div>
        </section>

        <section className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm text-white font-medium">Default Routing Policy</h2>
            <Link2 className="w-4 h-4 text-zinc-500" />
          </div>

          <p className="text-xs text-zinc-500 mb-3">
            This destination is used when no bot-specific policy override applies.
          </p>

          <select
            disabled={isReadOnly || endpoints.length === 0}
            value={defaultEndpointId}
            onChange={(e) => setDefaultEndpointId(e.target.value)}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
          >
            <option value="">Choose default endpoint</option>
            {endpoints.filter((ep) => ep.isActive).map((ep) => (
              <option key={ep.id} value={ep.id}>{ep.label} ({ep.channel})</option>
            ))}
          </select>

          <button
            disabled={isReadOnly || saving || !defaultEndpointId}
            onClick={handleSaveDefaultPolicy}
            className="mt-3 inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900 disabled:opacity-50"
          >
            <Save className="w-4 h-4" /> Save Default Policy
          </button>

          <div className="mt-5 rounded-lg border border-zinc-800 p-3">
            <p className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Bot Overrides</p>
            {policies.filter((p) => p.scope === 'BOT').length === 0 ? (
              <p className="text-xs text-zinc-500">No bot-specific overrides configured yet.</p>
            ) : (
              <div className="space-y-2">
                {policies
                  .filter((p) => p.scope === 'BOT')
                  .map((policy) => (
                    <div key={policy.id} className="text-xs text-zinc-300 rounded border border-zinc-800 px-2 py-1.5">
                      {policy.name} · {bots.find((b) => b.id === policy.botId)?.name ?? 'Unknown bot'}
                    </div>
                  ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
