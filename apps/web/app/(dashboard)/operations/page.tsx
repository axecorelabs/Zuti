'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Search, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { botsApi, conversationsApi, orgsApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

type OperationsTab = 'ACTION_TASKS' | 'LEADS' | 'BOOKINGS' | 'SALES_ORDERS' | 'TECH_ISSUES';
type BotSkill = 'SALES' | 'BOOKING' | 'SUPPORT' | 'TECHNICAL' | 'FORWARDING';

interface Org { id: string }
interface BotItem {
  id: string;
  name: string;
  skills?: BotSkill[];
  capabilities?: Record<string, unknown>;
  actionForwardingEnabled?: boolean;
}

interface PaginatedRecordsResponse {
  items: any[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface RowPresentation {
  summary: string;
  status: string;
  detailLines: string[];
}

type DetailViewMode = 'FULL' | 'STRUCTURED';

interface StructuredFieldRow {
  label: string;
  value: string;
}

interface StructuredDetailSection {
  title: string;
  rows: StructuredFieldRow[];
}

interface StructuredTableColumn {
  key: string;
  label: string;
  getValue: (row: any) => string;
  className?: string;
}

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SINGLE_EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

const PAGE_SIZE = 25;

const TABS: Array<{ key: OperationsTab; label: string }> = [
  { key: 'ACTION_TASKS', label: 'Action Tasks' },
  { key: 'LEADS', label: 'Leads' },
  { key: 'BOOKINGS', label: 'Bookings' },
  { key: 'SALES_ORDERS', label: 'Sales Orders' },
  { key: 'TECH_ISSUES', label: 'Technical Issues' },
];

const TAB_SKILL_REQUIREMENTS: Record<OperationsTab, BotSkill[] | null> = {
  ACTION_TASKS: null,
  LEADS: ['SALES'],
  BOOKINGS: ['BOOKING'],
  SALES_ORDERS: ['SALES'],
  TECH_ISSUES: ['SUPPORT', 'TECHNICAL'],
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asDateText(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function asStructuredText(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value.trim().length > 0 ? value.trim() : '—';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    const items = value
      .map((item) => asStructuredText(item))
      .filter((item) => item !== '—');
    return items.length > 0 ? items.join(', ') : '—';
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '—';
    }
  }
  return String(value);
}

function getValueAtPath(row: any, path: string): unknown {
  return path.split('.').reduce((current: any, part) => (current && typeof current === 'object' ? current[part] : undefined), row);
}

function buildFieldRow(label: string, value: unknown, formatter: (input: unknown) => string = asStructuredText): StructuredFieldRow {
  return { label, value: formatter(value) };
}

function buildStructuredDetailSections(tab: OperationsTab, row: any): StructuredDetailSection[] {
  const metadata = asObject(row.metadata);
  const customFieldRows = Object.entries(asObject(metadata?.customFields) ?? {})
    .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
    .map(([key, value]) => buildFieldRow(key.replace(/_/g, ' '), value));

  if (tab === 'ACTION_TASKS') {
    return [
      {
        title: 'Core fields',
        rows: [
          buildFieldRow('Task ID', row.id),
          buildFieldRow('Created', row.createdAt, asDateText),
          buildFieldRow('Bot', row.bot?.name),
          buildFieldRow('Status', row.status),
          buildFieldRow('Action type', row.actionType),
          buildFieldRow('Summary', row.summary),
          buildFieldRow('Conversation ID', row.conversationId),
          buildFieldRow('Customer name', row.conversation?.customerName),
          buildFieldRow('Customer email', row.conversation?.customerEmail),
          buildFieldRow('Assigned endpoint', row.assignedEndpoint?.destination),
          buildFieldRow('Routed policy', row.routedPolicy?.name),
          buildFieldRow('Dedupe key', row.dedupeKey),
        ],
      },
      {
        title: 'Delivery evidence',
        rows: [
          buildFieldRow('Acknowledged at', row.acknowledgedAt, asDateText),
          buildFieldRow('Completed at', row.completedAt, asDateText),
          buildFieldRow('Latest delivery status', row.deliveries?.[0]?.status),
          buildFieldRow('Latest sent at', row.deliveries?.[0]?.sentAt, asDateText),
          buildFieldRow('Latest delivered at', row.deliveries?.[0]?.deliveredAt, asDateText),
          buildFieldRow('Latest acknowledged at', row.deliveries?.[0]?.acknowledgedAt, asDateText),
          buildFieldRow('Latest error', row.deliveries?.[0]?.errorMessage),
        ],
      },
      ...(customFieldRows.length > 0 ? [{ title: 'Custom fields', rows: customFieldRows }] : []),
    ];
  }

  if (tab === 'LEADS') {
    return [
      {
        title: 'Core fields',
        rows: [
          buildFieldRow('Lead ID', row.id),
          buildFieldRow('Created', row.createdAt, asDateText),
          buildFieldRow('Bot', row.bot?.name),
          buildFieldRow('Status', row.status),
          buildFieldRow('Full name', row.fullName),
          buildFieldRow('Email', row.email),
          buildFieldRow('Phone', row.phone),
          buildFieldRow('Interest', row.interest),
          buildFieldRow('Budget', row.budget),
          buildFieldRow('Notes', row.notes),
          buildFieldRow('Action task status', row.actionTask?.status),
          buildFieldRow('Action task summary', row.actionTask?.summary),
        ],
      },
      ...(customFieldRows.length > 0 ? [{ title: 'Custom fields', rows: customFieldRows }] : []),
    ];
  }

  if (tab === 'BOOKINGS') {
    return [
      {
        title: 'Core fields',
        rows: [
          buildFieldRow('Booking ID', row.id),
          buildFieldRow('Created', row.createdAt, asDateText),
          buildFieldRow('Bot', row.bot?.name),
          buildFieldRow('Status', row.status),
          buildFieldRow('Customer name', row.customerName),
          buildFieldRow('Customer email', row.customerEmail),
          buildFieldRow('Preferred time', row.preferredDatetime),
          buildFieldRow('Reason', row.metadata?.bookingReason),
          buildFieldRow('Notes', row.notes),
          buildFieldRow('Action task status', row.actionTask?.status),
          buildFieldRow('Action task summary', row.actionTask?.summary),
        ],
      },
      ...(customFieldRows.length > 0 ? [{ title: 'Custom fields', rows: customFieldRows }] : []),
    ];
  }

  if (tab === 'SALES_ORDERS') {
    return [
      {
        title: 'Core fields',
        rows: [
          buildFieldRow('Order ID', row.id),
          buildFieldRow('Created', row.createdAt, asDateText),
          buildFieldRow('Bot', row.bot?.name),
          buildFieldRow('Status', row.status),
          buildFieldRow('Customer name', row.customerName),
          buildFieldRow('Customer email', row.customerEmail),
          buildFieldRow('Product', row.product),
          buildFieldRow('Quantity', row.quantity),
          buildFieldRow('Notes', row.notes),
          buildFieldRow('Action task status', row.actionTask?.status),
          buildFieldRow('Action task summary', row.actionTask?.summary),
        ],
      },
      ...(customFieldRows.length > 0 ? [{ title: 'Custom fields', rows: customFieldRows }] : []),
    ];
  }

  return [
    {
      title: 'Core fields',
      rows: [
        buildFieldRow('Issue ID', row.id),
        buildFieldRow('Created', row.createdAt, asDateText),
        buildFieldRow('Bot', row.bot?.name),
        buildFieldRow('Status', row.status),
        buildFieldRow('Reporter name', row.reporterName),
        buildFieldRow('Reporter email', row.reporterEmail),
        buildFieldRow('Issue category', row.issueCategory),
        buildFieldRow('Severity', row.severity),
        buildFieldRow('Summary', row.summary),
        buildFieldRow('Details', row.details),
        buildFieldRow('Action task status', row.actionTask?.status),
        buildFieldRow('Action task summary', row.actionTask?.summary),
      ],
    },
    ...(customFieldRows.length > 0 ? [{ title: 'Custom fields', rows: customFieldRows }] : []),
  ];
}

function buildStructuredViewRows(tab: OperationsTab, row: any): StructuredFieldRow[] {
  const sections = buildStructuredDetailSections(tab, row);
  return sections.flatMap((section) => section.rows);
}

function collectCustomFieldKeys(rows: any[]): string[] {
  const keys = new Set<string>();
  rows.forEach((row) => {
    const metadata = asObject(row?.metadata);
    const customFields = asObject(metadata?.customFields);
    Object.keys(customFields ?? {}).forEach((key) => {
      if (key.trim().length > 0) keys.add(key);
    });
  });
  return Array.from(keys).sort((a, b) => a.localeCompare(b));
}

function formatKnownValue(value: unknown): string {
  return asStructuredText(value);
}

function getExtraMetadataText(row: any, knownCustomKeys: string[]): string {
  const metadata = asObject(row?.metadata);
  if (!metadata) return '—';

  const extraEntries = Object.entries(metadata).filter(([key]) => key !== 'customFields');
  const customFields = asObject(metadata.customFields);
  const unknownCustomFields = Object.entries(customFields ?? {}).filter(([key]) => !knownCustomKeys.includes(key));

  const parts = [
    ...extraEntries.map(([key, value]) => `${key.replace(/_/g, ' ')}: ${asStructuredText(value)}`),
    ...unknownCustomFields.map(([key, value]) => `${key.replace(/_/g, ' ')}: ${asStructuredText(value)}`),
  ].filter((part) => part.length > 0);

  return parts.length > 0 ? parts.join(' · ') : '—';
}

function buildStructuredTableColumns(tab: OperationsTab, rows: any[]): StructuredTableColumn[] {
  const customKeys = collectCustomFieldKeys(rows);
  const extraKeyList = customKeys;

  const schemas: Record<OperationsTab, StructuredTableColumn[]> = {
    ACTION_TASKS: [
      { key: 'createdAt', label: 'Created', getValue: (row) => asDateText(row.createdAt) },
      { key: 'bot', label: 'Bot', getValue: (row) => formatKnownValue(row.bot?.name) },
      { key: 'actionType', label: 'Action type', getValue: (row) => formatKnownValue(row.actionType) },
      { key: 'status', label: 'Status', getValue: (row) => formatKnownValue(row.status) },
      { key: 'summary', label: 'Summary', getValue: (row) => formatKnownValue(row.summary), className: 'min-w-[260px]' },
      { key: 'conversation', label: 'Conversation', getValue: (row) => formatKnownValue(row.conversation?.id) },
      { key: 'customerName', label: 'Customer name', getValue: (row) => formatKnownValue(row.conversation?.customerName) },
      { key: 'customerEmail', label: 'Customer email', getValue: (row) => formatKnownValue(row.conversation?.customerEmail) },
      { key: 'assignedEndpoint', label: 'Assigned endpoint', getValue: (row) => formatKnownValue(row.assignedEndpoint?.destination) },
      { key: 'routedPolicy', label: 'Routed policy', getValue: (row) => formatKnownValue(row.routedPolicy?.name) },
      { key: 'acknowledgedAt', label: 'Acknowledged at', getValue: (row) => asDateText(row.acknowledgedAt) },
      { key: 'completedAt', label: 'Completed at', getValue: (row) => asDateText(row.completedAt) },
      { key: 'deliveryStatus', label: 'Delivery status', getValue: (row) => formatKnownValue(row.deliveries?.[0]?.status) },
      { key: 'deliveredAt', label: 'Delivered at', getValue: (row) => asDateText(row.deliveries?.[0]?.deliveredAt) },
      { key: 'sentAt', label: 'Sent at', getValue: (row) => asDateText(row.deliveries?.[0]?.sentAt) },
      { key: 'deliveryError', label: 'Delivery error', getValue: (row) => formatKnownValue(row.deliveries?.[0]?.errorMessage), className: 'min-w-[220px]' },
      { key: 'dedupeKey', label: 'Dedupe key', getValue: (row) => formatKnownValue(row.dedupeKey), className: 'min-w-[220px]' },
      { key: 'extra', label: 'Extra metadata', getValue: (row) => getExtraMetadataText(row, customKeys), className: 'min-w-[280px]' },
    ],
    LEADS: [
      { key: 'createdAt', label: 'Created', getValue: (row) => asDateText(row.createdAt) },
      { key: 'bot', label: 'Bot', getValue: (row) => formatKnownValue(row.bot?.name) },
      { key: 'status', label: 'Status', getValue: (row) => formatKnownValue(row.status) },
      { key: 'fullName', label: 'Full name', getValue: (row) => formatKnownValue(row.fullName) },
      { key: 'email', label: 'Email', getValue: (row) => formatKnownValue(row.email) },
      { key: 'phone', label: 'Phone', getValue: (row) => formatKnownValue(row.phone) },
      { key: 'interest', label: 'Interest', getValue: (row) => formatKnownValue(row.interest) },
      { key: 'budget', label: 'Budget', getValue: (row) => formatKnownValue(row.budget) },
      { key: 'notes', label: 'Notes', getValue: (row) => formatKnownValue(row.notes), className: 'min-w-[240px]' },
      { key: 'actionStatus', label: 'Action status', getValue: (row) => formatKnownValue(row.actionTask?.status) },
      { key: 'actionSummary', label: 'Action summary', getValue: (row) => formatKnownValue(row.actionTask?.summary), className: 'min-w-[240px]' },
      { key: 'extra', label: 'Extra metadata', getValue: (row) => getExtraMetadataText(row, customKeys), className: 'min-w-[280px]' },
    ],
    BOOKINGS: [
      { key: 'createdAt', label: 'Created', getValue: (row) => asDateText(row.createdAt) },
      { key: 'bot', label: 'Bot', getValue: (row) => formatKnownValue(row.bot?.name) },
      { key: 'status', label: 'Status', getValue: (row) => formatKnownValue(row.status) },
      { key: 'customerName', label: 'Customer name', getValue: (row) => formatKnownValue(row.customerName) },
      { key: 'customerEmail', label: 'Customer email', getValue: (row) => formatKnownValue(row.customerEmail) },
      { key: 'preferredDatetime', label: 'Preferred time', getValue: (row) => formatKnownValue(row.preferredDatetime) },
      { key: 'reason', label: 'Reason', getValue: (row) => formatKnownValue(row.metadata?.bookingReason), className: 'min-w-[220px]' },
      { key: 'notes', label: 'Notes', getValue: (row) => formatKnownValue(row.notes), className: 'min-w-[240px]' },
      { key: 'actionStatus', label: 'Action status', getValue: (row) => formatKnownValue(row.actionTask?.status) },
      { key: 'actionSummary', label: 'Action summary', getValue: (row) => formatKnownValue(row.actionTask?.summary), className: 'min-w-[240px]' },
      { key: 'extra', label: 'Extra metadata', getValue: (row) => getExtraMetadataText(row, customKeys), className: 'min-w-[280px]' },
    ],
    SALES_ORDERS: [
      { key: 'createdAt', label: 'Created', getValue: (row) => asDateText(row.createdAt) },
      { key: 'bot', label: 'Bot', getValue: (row) => formatKnownValue(row.bot?.name) },
      { key: 'status', label: 'Status', getValue: (row) => formatKnownValue(row.status) },
      { key: 'customerName', label: 'Customer name', getValue: (row) => formatKnownValue(row.customerName) },
      { key: 'customerEmail', label: 'Customer email', getValue: (row) => formatKnownValue(row.customerEmail) },
      { key: 'product', label: 'Product', getValue: (row) => formatKnownValue(row.product) },
      { key: 'quantity', label: 'Quantity', getValue: (row) => formatKnownValue(row.quantity) },
      { key: 'notes', label: 'Notes', getValue: (row) => formatKnownValue(row.notes), className: 'min-w-[240px]' },
      { key: 'actionStatus', label: 'Action status', getValue: (row) => formatKnownValue(row.actionTask?.status) },
      { key: 'actionSummary', label: 'Action summary', getValue: (row) => formatKnownValue(row.actionTask?.summary), className: 'min-w-[240px]' },
      { key: 'extra', label: 'Extra metadata', getValue: (row) => getExtraMetadataText(row, customKeys), className: 'min-w-[280px]' },
    ],
    TECH_ISSUES: [
      { key: 'createdAt', label: 'Created', getValue: (row) => asDateText(row.createdAt) },
      { key: 'bot', label: 'Bot', getValue: (row) => formatKnownValue(row.bot?.name) },
      { key: 'status', label: 'Status', getValue: (row) => formatKnownValue(row.status) },
      { key: 'reporterName', label: 'Reporter name', getValue: (row) => formatKnownValue(row.reporterName) },
      { key: 'reporterEmail', label: 'Reporter email', getValue: (row) => formatKnownValue(row.reporterEmail) },
      { key: 'issueCategory', label: 'Issue category', getValue: (row) => formatKnownValue(row.issueCategory) },
      { key: 'severity', label: 'Severity', getValue: (row) => formatKnownValue(row.severity) },
      { key: 'summary', label: 'Summary', getValue: (row) => formatKnownValue(row.summary), className: 'min-w-[260px]' },
      { key: 'details', label: 'Details', getValue: (row) => formatKnownValue(row.details), className: 'min-w-[280px]' },
      { key: 'actionStatus', label: 'Action status', getValue: (row) => formatKnownValue(row.actionTask?.status) },
      { key: 'actionSummary', label: 'Action summary', getValue: (row) => formatKnownValue(row.actionTask?.summary), className: 'min-w-[240px]' },
      { key: 'extra', label: 'Extra metadata', getValue: (row) => getExtraMetadataText(row, customKeys), className: 'min-w-[280px]' },
    ],
  };

  return [...schemas[tab], ...customKeys.map((key) => ({
    key: `custom:${key}`,
    label: key.replace(/_/g, ' '),
    getValue: (row: any) => asStructuredText(asObject(asObject(row.metadata)?.customFields)?.[key]),
    className: 'min-w-[180px]',
  }))];
}

function getCustomFieldLines(metadata: unknown): string[] {
  const meta = asObject(metadata);
  const custom = asObject(meta?.customFields);
  if (!custom) return [];

  return Object.entries(custom)
    .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
    .map(([key, value]) => `${key.replace(/_/g, ' ')}: ${String(value).trim()}`);
}

function inferBotSkills(bot: BotItem): BotSkill[] {
  if (Array.isArray(bot.skills) && bot.skills.length > 0) {
    return Array.from(new Set(bot.skills));
  }

  const capabilities = (bot.capabilities ?? {}) as Record<string, unknown>;
  const skillsObject = (capabilities.skills ?? {}) as Record<string, unknown>;
  const inferred: BotSkill[] = [];

  if (skillsObject.FORWARDING === true || bot.actionForwardingEnabled === true) inferred.push('FORWARDING');
  if (skillsObject.SALES === true || capabilities.canCreateLead === true || capabilities.canCreateOrder === true) inferred.push('SALES');
  if (skillsObject.BOOKING === true || capabilities.canCreateMeetingRequest === true) inferred.push('BOOKING');
  if (skillsObject.SUPPORT === true) inferred.push('SUPPORT');
  if (skillsObject.TECHNICAL === true || capabilities.canCreateTechnicalIssue === true) inferred.push('TECHNICAL');

  return Array.from(new Set(inferred));
}

function hasRequiredSkills(enabledSkills: Set<BotSkill>, required: BotSkill[] | null): boolean {
  if (!required || required.length === 0) return true;
  return required.some((skill) => enabledSkills.has(skill));
}

function getActionTaskForEvidence(tab: OperationsTab, row: any): any | null {
  if (tab === 'ACTION_TASKS') return row;
  return row.actionTask ?? null;
}

function getDeliveryEvidenceLines(tab: OperationsTab, row: any): string[] {
  const task = getActionTaskForEvidence(tab, row);
  if (!task) return [];
  const deliveries = Array.isArray(task.deliveries) ? task.deliveries : [];
  const lines = [
    task.id ? `Action task: ${task.id}` : null,
    task.actionType ? `Action type: ${task.actionType}` : row.actionType ? `Action type: ${row.actionType}` : null,
    task.status ? `Task status: ${task.status}` : row.status ? `Task status: ${row.status}` : null,
    task.assignedEndpoint?.destination ? `Assigned endpoint: ${task.assignedEndpoint.destination}` : row.assignedEndpoint?.destination ? `Assigned endpoint: ${row.assignedEndpoint.destination}` : null,
    ...deliveries.map((delivery: any) => {
      const parts = [
        delivery.channel,
        delivery.status,
        delivery.sentAt ? `sent ${new Date(delivery.sentAt).toLocaleString()}` : null,
        delivery.deliveredAt ? `delivered ${new Date(delivery.deliveredAt).toLocaleString()}` : null,
        delivery.acknowledgedAt ? `acknowledged ${new Date(delivery.acknowledgedAt).toLocaleString()}` : null,
        delivery.errorMessage ? `error: ${delivery.errorMessage}` : null,
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(' | ') : null;
    }),
  ].filter(Boolean);

  return lines as string[];
}

function buildRowPresentation(tab: OperationsTab, row: any): RowPresentation {
  const summary =
    tab === 'BOOKINGS'
      ? (row.customerName || row.customerEmail || row.actionTask?.summary || '-')
      : tab === 'SALES_ORDERS'
        ? ([row.customerName, row.product].filter(Boolean).join(' - ') || row.actionTask?.summary || '-')
        : tab === 'TECH_ISSUES'
          ? (row.summary || row.actionTask?.summary || row.reporterName || '-')
          : tab === 'LEADS'
            ? (row.fullName || row.email || row.interest || '-')
            : (
              row.summary ||
              row.actionTask?.summary ||
              row.fullName ||
              row.customerName ||
              row.reporterName ||
              row.preferredDatetime ||
              row.product ||
              '-'
            );

  const rowStatus = row.status || row.actionTask?.status || '-';
  const customFieldLines = getCustomFieldLines(row.metadata);
  const detailLines =
    tab === 'BOOKINGS'
      ? [
          row.customerEmail ? `email: ${row.customerEmail}` : null,
          row.preferredDatetime ? `preferred time: ${row.preferredDatetime}` : null,
          typeof row.metadata?.bookingReason === 'string' && row.metadata.bookingReason
            ? `reason: ${row.metadata.bookingReason}`
            : null,
          row.notes ? `notes: ${row.notes}` : null,
          ...customFieldLines,
        ].filter(Boolean)
      : tab === 'SALES_ORDERS'
        ? [
            row.customerEmail ? `email: ${row.customerEmail}` : null,
            row.product ? `product: ${row.product}` : null,
            row.quantity ? `quantity: ${row.quantity}` : null,
            row.notes ? `notes: ${row.notes}` : null,
            ...customFieldLines,
          ].filter(Boolean)
        : tab === 'TECH_ISSUES'
          ? [
              row.reporterEmail ? `email: ${row.reporterEmail}` : null,
              row.issueCategory ? `category: ${row.issueCategory}` : null,
              row.severity ? `severity: ${row.severity}` : null,
              row.details ? `details: ${row.details}` : null,
              ...customFieldLines,
            ].filter(Boolean)
          : tab === 'LEADS'
            ? [
                row.email ? `email: ${row.email}` : null,
                row.phone ? `phone: ${row.phone}` : null,
                typeof row.metadata?.companyName === 'string' && row.metadata.companyName
                  ? `company: ${row.metadata.companyName}`
                  : null,
                row.interest ? `interest: ${row.interest}` : null,
                row.budget ? `budget: ${row.budget}` : null,
                row.notes ? `notes: ${row.notes}` : null,
              ].filter(Boolean)
            : [
                row.conversation?.customerEmail ? `email: ${row.conversation.customerEmail}` : null,
                row.assignedEndpoint?.destination ? `endpoint: ${row.assignedEndpoint.destination}` : null,
                row.actionType ? `action: ${row.actionType}` : null,
                row.dedupeKey ? `dedupe: ${row.dedupeKey}` : null,
              ].filter(Boolean);

  return { summary, status: rowStatus, detailLines: detailLines as string[] };
}

function renderLineWithEmailLinks(line: string, keyPrefix: string) {
  const matches = Array.from(line.matchAll(EMAIL_PATTERN));
  if (matches.length === 0) return line;

  const parts: JSX.Element[] = [];
  let cursor = 0;

  matches.forEach((match, index) => {
    const email = match[0];
    const start = match.index ?? 0;
    if (start > cursor) {
      parts.push(<span key={`${keyPrefix}-txt-${index}`}>{line.slice(cursor, start)}</span>);
    }
    parts.push(
      <a
        key={`${keyPrefix}-mail-${index}`}
        href={`mailto:${email}`}
        className="text-blue-300 underline decoration-blue-400/60 underline-offset-2 hover:text-blue-200"
      >
        {email}
      </a>,
    );
    cursor = start + email.length;
  });

  if (cursor < line.length) {
    parts.push(<span key={`${keyPrefix}-tail`}>{line.slice(cursor)}</span>);
  }

  return parts;
}

function getSourceConversationId(tab: OperationsTab, row: any): string | null {
  if (tab === 'ACTION_TASKS') return row.conversation?.id ?? null;
  return row.actionTask?.conversationId ?? null;
}

function getFollowUpEmail(tab: OperationsTab, row: any, detailLines: string[]): string | null {
  const knownEmail =
    tab === 'ACTION_TASKS'
      ? (row.conversation?.customerEmail ?? null)
      : tab === 'LEADS'
        ? (row.email ?? null)
        : tab === 'BOOKINGS'
          ? (row.customerEmail ?? null)
          : tab === 'SALES_ORDERS'
            ? (row.customerEmail ?? null)
            : tab === 'TECH_ISSUES'
              ? (row.reporterEmail ?? null)
              : null;

  if (typeof knownEmail === 'string' && knownEmail.trim().length > 0) return knownEmail.trim();

  for (const line of detailLines) {
    const match = line.match(SINGLE_EMAIL_PATTERN);
    if (match?.[0]) return match[0];
  }

  return null;
}

function getFollowUpCustomerName(tab: OperationsTab, row: any): string | null {
  const name =
    tab === 'ACTION_TASKS'
      ? (row.conversation?.customerName ?? null)
      : tab === 'LEADS'
        ? (row.fullName ?? null)
        : tab === 'BOOKINGS'
          ? (row.customerName ?? null)
          : tab === 'SALES_ORDERS'
            ? (row.customerName ?? null)
            : tab === 'TECH_ISSUES'
              ? (row.reporterName ?? null)
              : null;
  return typeof name === 'string' && name.trim().length > 0 ? name.trim() : null;
}

export default function OperationsPage() {
  const router = useRouter();
  const { activeOrgId } = useAuthStore();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [bots, setBots] = useState<BotItem[]>([]);
  const [tab, setTab] = useState<OperationsTab>('ACTION_TASKS');
  const [botId, setBotId] = useState<string>('ALL');
  const [status, setStatus] = useState<string>('ALL');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [selectedRow, setSelectedRow] = useState<any | null>(null);
  const [isDetailsPanelOpen, setIsDetailsPanelOpen] = useState(false);
  const [detailViewMode, setDetailViewMode] = useState<DetailViewMode>('FULL');
  const [tableViewMode, setTableViewMode] = useState<'COMPACT' | 'STRUCTURED'>('COMPACT');
  const [startingFollowUp, setStartingFollowUp] = useState(false);
  const [allowExternalDelivery, setAllowExternalDelivery] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const enabledSkills = useMemo(() => {
    const collected = new Set<BotSkill>();
    bots.forEach((bot) => {
      inferBotSkills(bot).forEach((skill) => collected.add(skill));
    });
    return collected;
  }, [bots]);

  const visibleTabs = useMemo(
    () => TABS.filter((item) => hasRequiredSkills(enabledSkills, TAB_SKILL_REQUIREMENTS[item.key])),
    [enabledSkills],
  );

  const structuredColumns = useMemo(() => buildStructuredTableColumns(tab, rows), [tab, rows]);

  const openDetailsPanel = (row: any) => {
    setSelectedRow(row);
    requestAnimationFrame(() => setIsDetailsPanelOpen(true));
  };

  const closeDetailsPanel = () => {
    setIsDetailsPanelOpen(false);
    setTimeout(() => setSelectedRow(null), 220);
    setAllowExternalDelivery(true);
    setDetailViewMode('FULL');
  };

  const openSourceConversation = (conversationId: string) => {
    closeDetailsPanel();
    router.push(`/inbox?conversationId=${encodeURIComponent(conversationId)}`);
  };

  const startFollowUpConversation = async (row: any, view: RowPresentation) => {
    if (!orgId) return;
    const email = getFollowUpEmail(tab, row, view.detailLines);
    if (!email) {
      toast.error('No customer email found in this record');
      return;
    }
    const botIdValue = row.bot?.id;
    if (!botIdValue) {
      toast.error('No bot found for this record');
      return;
    }

    try {
      setStartingFollowUp(true);
      const sourceConversationId = getSourceConversationId(tab, row);
      const response = await conversationsApi.startInternal(orgId, {
        botId: botIdValue,
        customerEmail: email,
        customerName: getFollowUpCustomerName(tab, row) ?? undefined,
        subject: `Follow-up: ${view.summary}`,
        sourceRecordType: tab,
        sourceRecordId: String(row.id ?? ''),
        sourceActionTaskId: row.actionTask?.id ?? (tab === 'ACTION_TASKS' ? row.id : undefined),
        sourceConversationId: sourceConversationId ?? undefined,
        allowExternalDelivery,
      });

      const conversationId = response.data?.id as string | undefined;
      const reused = response.data?.reused === true;
      if (!conversationId) {
        toast.error('Unable to open inbox conversation');
        return;
      }

      closeDetailsPanel();
      router.push(`/inbox?conversationId=${encodeURIComponent(conversationId)}`);
      toast.success(reused ? 'Existing internal follow-up opened' : 'Internal follow-up conversation started');
    } catch {
      toast.error('Failed to start internal follow-up conversation');
    } finally {
      setStartingFollowUp(false);
    }
  };

  useEffect(() => {
    orgsApi.list().then(async (res) => {
      const orgs = (res.data ?? []) as Org[];
      const preferred = activeOrgId
        ? (orgs.find((org) => org.id === activeOrgId) ?? orgs[0])
        : orgs[0];
      if (!preferred) {
        setLoading(false);
        return;
      }
      setOrgId(preferred.id);
      const botsRes = await botsApi.list(preferred.id).catch(() => ({ data: [] }));
      setBots((botsRes.data ?? []).map((b: BotItem) => ({
        id: b.id,
        name: b.name,
        skills: Array.isArray(b.skills) ? b.skills : undefined,
        capabilities: b.capabilities,
        actionForwardingEnabled: b.actionForwardingEnabled,
      })));
    }).catch(() => setLoading(false));
  }, [activeOrgId]);

  useEffect(() => {
    if (visibleTabs.length === 0) return;
    if (!visibleTabs.some((item) => item.key === tab)) {
      setTab(visibleTabs[0].key);
      setStatus('ALL');
      setPage(1);
    }
  }, [visibleTabs, tab]);

  const getBaseParams = (overrides?: { page?: number; limit?: number }) => ({
      botId: botId !== 'ALL' ? botId : undefined,
      status: status !== 'ALL' ? status : undefined,
      q: q.trim() || undefined,
      limit: overrides?.limit ?? PAGE_SIZE,
      page: overrides?.page ?? page,
    });

  const fetchByTab = async (params: Record<string, string | number | undefined>): Promise<PaginatedRecordsResponse> => {
    if (!orgId) return { items: [], total: 0, page: 1, limit: PAGE_SIZE, totalPages: 1 };
    if (tab === 'ACTION_TASKS') {
      const res = await orgsApi.listActionTasks(orgId, params as any);
      return res.data as PaginatedRecordsResponse;
    }
    if (tab === 'LEADS') {
      const res = await orgsApi.listLeads(orgId, params as any);
      return res.data as PaginatedRecordsResponse;
    }
    if (tab === 'BOOKINGS') {
      const res = await orgsApi.listBookings(orgId, params as any);
      return res.data as PaginatedRecordsResponse;
    }
    if (tab === 'SALES_ORDERS') {
      const res = await orgsApi.listSalesOrders(orgId, params as any);
      return res.data as PaginatedRecordsResponse;
    }
    const res = await orgsApi.listTechnicalIssues(orgId, params as any);
    return res.data as PaginatedRecordsResponse;
  };

  const loadRows = async () => {
    if (!orgId) return;
    setLoading(true);

    try {
      const data = await fetchByTab(getBaseParams());
      setRows(data.items ?? []);
      setTotal(data.total ?? 0);
      setTotalPages(data.totalPages ?? 1);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!orgId) return;
    loadRows();
  }, [orgId, tab, botId, status, page]);

  useEffect(() => {
    setSelectedRow(null);
    setIsDetailsPanelOpen(false);
    setAllowExternalDelivery(true);
    setDetailViewMode('FULL');
  }, [tab, page, botId, status]);

  const statusOptions = useMemo(() => {
    if (tab === 'ACTION_TASKS') return ['DETECTED', 'QUEUED', 'ROUTED', 'SENT', 'DELIVERED', 'FAILED', 'COMPLETED'];
    if (tab === 'BOOKINGS') return ['REQUESTED', 'CONFIRMED', 'RESCHEDULED', 'CANCELLED'];
    if (tab === 'SALES_ORDERS') return ['NEW', 'PROCESSING', 'COMPLETED', 'CANCELLED'];
    if (tab === 'TECH_ISSUES') return ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
    return [] as string[];
  }, [tab]);

  const handleExportCsv = async () => {
    if (!orgId) return;
    setExporting(true);
    try {
      let currentPage = 1;
      const allItems: any[] = [];
      while (true) {
        const data = await fetchByTab(getBaseParams({ page: currentPage, limit: 200 }));
        allItems.push(...(data.items ?? []));
        if (currentPage >= (data.totalPages ?? 1)) break;
        currentPage += 1;
      }

      const csvEscape = (value: unknown): string => {
        const text = String(value ?? '');
        if (text.includes(',') || text.includes('"') || text.includes('\n')) {
          return `"${text.replace(/"/g, '""')}"`;
        }
        return text;
      };

      const buildRows = (): { headers: string[]; records: string[][] } => {
        if (tab === 'ACTION_TASKS') {
          const headers = ['id', 'createdAt', 'bot', 'actionType', 'status', 'summary', 'customerName', 'customerEmail', 'endpoint', 'dedupeKey'];
          const records = allItems.map((row) => [
            row.id,
            row.createdAt,
            row.bot?.name,
            row.actionType,
            row.status,
            row.summary,
            row.conversation?.customerName,
            row.conversation?.customerEmail,
            row.assignedEndpoint?.destination,
            row.dedupeKey,
          ].map(csvEscape));
          return { headers, records };
        }
        if (tab === 'LEADS') {
          const headers = ['id', 'createdAt', 'bot', 'fullName', 'email', 'phone', 'interest', 'budget', 'notes', 'actionStatus'];
          const records = allItems.map((row) => [
            row.id,
            row.createdAt,
            row.bot?.name,
            row.fullName,
            row.email,
            row.phone,
            row.interest,
            row.budget,
            row.notes,
            row.actionTask?.status,
          ].map(csvEscape));
          return { headers, records };
        }
        if (tab === 'BOOKINGS') {
          const headers = ['id', 'createdAt', 'bot', 'customerName', 'customerEmail', 'preferredDatetime', 'status', 'notes', 'actionStatus'];
          const records = allItems.map((row) => [
            row.id,
            row.createdAt,
            row.bot?.name,
            row.customerName,
            row.customerEmail,
            row.preferredDatetime,
            row.status,
            row.notes,
            row.actionTask?.status,
          ].map(csvEscape));
          return { headers, records };
        }
        if (tab === 'SALES_ORDERS') {
          const headers = ['id', 'createdAt', 'bot', 'customerName', 'customerEmail', 'product', 'quantity', 'status', 'notes', 'actionStatus'];
          const records = allItems.map((row) => [
            row.id,
            row.createdAt,
            row.bot?.name,
            row.customerName,
            row.customerEmail,
            row.product,
            row.quantity,
            row.status,
            row.notes,
            row.actionTask?.status,
          ].map(csvEscape));
          return { headers, records };
        }
        const headers = ['id', 'createdAt', 'bot', 'reporterName', 'reporterEmail', 'issueCategory', 'severity', 'summary', 'status', 'actionStatus'];
        const records = allItems.map((row) => [
          row.id,
          row.createdAt,
          row.bot?.name,
          row.reporterName,
          row.reporterEmail,
          row.issueCategory,
          row.severity,
          row.summary,
          row.status,
          row.actionTask?.status,
        ].map(csvEscape));
        return { headers, records };
      };

      const { headers, records } = buildRows();
      const csv = [headers.join(','), ...records.map((r) => r.join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const fileBase = tab.toLowerCase();
      a.href = url;
      a.download = `${fileBase}_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="operations-page p-4 md:p-8">
      <div className="mb-6">
        <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">Operations</h1>
        <p className="mt-1 text-sm text-zinc-500 font-light">
          Search and review action tasks, bookings, and collected records from forwarding workflows.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 bg-zinc-900 p-1 rounded-lg border border-zinc-800">
          {visibleTabs.map((item) => (
            <button
              key={item.key}
              onClick={() => {
                setTab(item.key);
                setStatus('ALL');
                setPage(1);
              }}
              className={`px-3 py-1.5 text-xs rounded-md ${
                tab === item.key ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="ml-auto inline-flex items-center rounded-lg border border-zinc-800 bg-zinc-950/80 p-1 text-[11px] text-zinc-400 backdrop-blur">
          <button
            type="button"
            onClick={() => setTableViewMode('COMPACT')}
            className={`rounded-md px-2.5 py-1 transition-colors ${tableViewMode === 'COMPACT' ? 'bg-zinc-800 text-zinc-100' : 'hover:text-zinc-200'}`}
          >
            Compact table
          </button>
          <button
            type="button"
            onClick={() => setTableViewMode('STRUCTURED')}
            className={`rounded-md px-2.5 py-1 transition-colors ${tableViewMode === 'STRUCTURED' ? 'bg-zinc-800 text-zinc-100' : 'hover:text-zinc-200'}`}
          >
            All details table
          </button>
        </div>
      </div>

      {tableViewMode === 'STRUCTURED' && (
        <div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-950/80 px-4 py-3 text-xs text-zinc-400 backdrop-blur">
          This view expands the main table into a structured field layout. Missing values render as em dashes, and any extra metadata/custom fields are surfaced in dedicated columns.
        </div>
      )}

      {visibleTabs.length < TABS.length && (
        <div className="mb-4 text-xs text-zinc-500">
          Showing only tabs for enabled workflows. Inactive workflow tables are hidden to reduce clutter.
        </div>
      )}

      <div className="mb-4 grid gap-2 md:grid-cols-4">
        <div className="md:col-span-2 flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
          <Search className="w-4 h-4 text-zinc-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (page === 1) {
                  loadRows();
                } else {
                  setPage(1);
                }
              }
            }}
            placeholder="Search by name, email, summary, product..."
            className="w-full bg-transparent text-sm text-zinc-200 outline-none"
          />
        </div>

        <select
          value={botId}
          onChange={(e) => {
            setBotId(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
        >
          <option value="ALL">All bots</option>
          {bots.map((bot) => (
            <option key={bot.id} value={bot.id}>{bot.name}</option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
          >
            <option value="ALL">All statuses</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button
            onClick={loadRows}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-zinc-300 hover:bg-zinc-900"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={handleExportCsv}
            disabled={exporting || loading}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
            title="Export CSV"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          {tableViewMode === 'COMPACT' ? (
            <table className="w-full min-w-[960px]">
              <thead className="bg-zinc-900/80 border-b border-zinc-800">
                <tr className="text-left text-xs text-zinc-500">
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Bot</th>
                  <th className="px-4 py-3">Summary</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-zinc-500">Loading...</td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-zinc-500">No records found.</td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const createdAt = row.createdAt ? new Date(row.createdAt).toLocaleString() : '-';
                    const botName = row.bot?.name || '-';
                    const view = buildRowPresentation(tab, row);
                    return (
                      <tr
                        key={row.id}
                        className="border-b border-zinc-900/70 text-sm cursor-pointer hover:bg-zinc-900/40 focus-within:bg-zinc-900/40"
                        onClick={() => openDetailsPanel(row)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            openDetailsPanel(row);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <td className="px-4 py-3 text-zinc-500">{createdAt}</td>
                        <td className="px-4 py-3 text-zinc-300">{botName}</td>
                        <td className="px-4 py-3 text-zinc-200">{view.summary}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex rounded-md border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300">
                            {view.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-zinc-500 w-[320px] max-w-[320px] align-top">
                          {view.detailLines.length === 0 ? (
                            '-'
                          ) : (
                            <div className="space-y-1">
                              {view.detailLines.slice(0, 3).map((line: string, index: number) => (
                                <div key={`${row.id}-detail-${index}`} className="text-xs leading-relaxed text-zinc-400 truncate">
                                  {line}
                                </div>
                              ))}
                              {view.detailLines.length > 3 && (
                                <div className="text-xs text-blue-400">+ {view.detailLines.length - 3} more</div>
                              )}
                              <div className="text-[11px] text-zinc-500 pt-1">View details</div>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full min-w-[1600px]">
              <thead className="bg-zinc-900/80 border-b border-zinc-800">
                <tr className="text-left text-xs text-zinc-500">
                  {structuredColumns.map((column) => (
                    <th key={column.key} className={`px-4 py-3 whitespace-nowrap ${column.className ?? ''}`}>{column.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={structuredColumns.length} className="px-4 py-8 text-center text-sm text-zinc-500">Loading...</td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={structuredColumns.length} className="px-4 py-8 text-center text-sm text-zinc-500">No records found.</td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-zinc-900/70 text-sm cursor-pointer hover:bg-zinc-900/40 focus-within:bg-zinc-900/40"
                      onClick={() => openDetailsPanel(row)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openDetailsPanel(row);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      {structuredColumns.map((column) => (
                        <td key={`${row.id}-${column.key}`} className={`px-4 py-3 text-zinc-200 align-top whitespace-pre-wrap break-words ${column.className ?? ''}`}>
                          {column.getValue(row)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
        <span>
          Showing page {page} of {totalPages} · {total} total records
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="rounded border border-zinc-700 px-2 py-1 text-zinc-300 disabled:opacity-50"
          >
            Prev
          </button>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
            className="rounded border border-zinc-700 px-2 py-1 text-zinc-300 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>

      {selectedRow && (
        <div
          className={`fixed inset-0 z-50 transition-opacity duration-200 ${isDetailsPanelOpen ? 'bg-black/60 opacity-100' : 'bg-black/0 opacity-0'}`}
          onClick={closeDetailsPanel}
        >
          <aside
            className={`absolute right-0 top-0 h-full w-full max-w-[560px] border-l border-zinc-800 bg-gradient-to-b from-zinc-950 via-zinc-950 to-zinc-900 shadow-2xl transition-transform duration-200 ease-out ${isDetailsPanelOpen ? 'translate-x-0' : 'translate-x-full'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-full overflow-y-auto">
              <div className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 px-5 py-4 backdrop-blur">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">Operations Record</p>
                    <h3 className="text-base font-semibold text-white mt-1">Record details</h3>
                    <p className="text-xs text-zinc-500 mt-1 break-all">{selectedRow.id}</p>
                  </div>
                  <button
                    type="button"
                    onClick={closeDetailsPanel}
                    className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:text-white hover:border-zinc-600"
                  >
                    Close
                  </button>
                </div>
              </div>

              {(() => {
                const view = buildRowPresentation(tab, selectedRow);
                const evidenceLines = getDeliveryEvidenceLines(tab, selectedRow);
                const structuredSections = buildStructuredDetailSections(tab, selectedRow);
                const selectedCreatedAt = selectedRow.createdAt ? new Date(selectedRow.createdAt).toLocaleString() : '-';
                const selectedBotName = selectedRow.bot?.name || '-';
                const sourceConversationId = getSourceConversationId(tab, selectedRow);
                const followUpEmail = getFollowUpEmail(tab, selectedRow, view.detailLines);
                return (
                  <div className="space-y-3 px-5 py-4">
                    <div className="flex flex-wrap gap-2">
                      <span className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900/80 px-2.5 py-1 text-[11px] text-zinc-300">
                        {TABS.find((item) => item.key === tab)?.label}
                      </span>
                      <span className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900/80 px-2.5 py-1 text-[11px] text-zinc-300">
                        {view.status}
                      </span>
                      <div className="ml-auto inline-flex items-center rounded-lg border border-zinc-800 bg-zinc-950/70 p-1 text-[11px] text-zinc-400 backdrop-blur">
                        <button
                          type="button"
                          onClick={() => setDetailViewMode('FULL')}
                          className={`rounded-md px-2.5 py-1 transition-colors ${detailViewMode === 'FULL' ? 'bg-zinc-800 text-zinc-100' : 'hover:text-zinc-200'}`}
                        >
                          Full view
                        </button>
                        <button
                          type="button"
                          onClick={() => setDetailViewMode('STRUCTURED')}
                          className={`rounded-md px-2.5 py-1 transition-colors ${detailViewMode === 'STRUCTURED' ? 'bg-zinc-800 text-zinc-100' : 'hover:text-zinc-200'}`}
                        >
                          Structured table
                        </button>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                        <p className="text-[11px] text-zinc-500">Bot</p>
                        <p className="text-sm text-zinc-200 mt-1 break-words max-w-[24ch]">{selectedBotName}</p>
                      </div>
                      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                        <p className="text-[11px] text-zinc-500">Created</p>
                        <p className="text-sm text-zinc-200 mt-1 break-words max-w-[24ch]">{selectedCreatedAt}</p>
                      </div>
                    </div>

                    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                      <p className="text-[11px] text-zinc-500 mb-1">Summary</p>
                      <p className="text-sm leading-6 text-zinc-200 break-words max-w-[52ch]">{view.summary}</p>
                    </div>

                    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                      <p className="text-[11px] text-zinc-500 mb-2">Conversation actions</p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => sourceConversationId && openSourceConversation(sourceConversationId)}
                          disabled={!sourceConversationId}
                          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:text-white hover:border-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Open source conversation
                        </button>
                        <button
                          type="button"
                          onClick={() => startFollowUpConversation(selectedRow, view)}
                          disabled={!followUpEmail || startingFollowUp}
                          className="rounded-lg border border-blue-600/50 px-3 py-1.5 text-xs text-blue-200 hover:bg-blue-600/10 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {startingFollowUp ? 'Starting follow-up...' : 'Start internal follow-up'}
                        </button>
                      </div>
                      <label className="mt-3 inline-flex items-center gap-2 text-xs text-zinc-300">
                        <input
                          type="checkbox"
                          checked={allowExternalDelivery}
                          onChange={(e) => setAllowExternalDelivery(e.target.checked)}
                          className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-900 text-blue-500 focus:ring-blue-500/40"
                        />
                        Allow external email delivery for this follow-up
                      </label>
                      <p className="text-[11px] text-zinc-500 mt-2">
                        {followUpEmail ? `Follow-up target: ${followUpEmail}` : 'No email found for follow-up in this record'}
                      </p>
                    </div>

                    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                      <p className="text-[11px] text-zinc-500 mb-2">Action evidence</p>
                      {evidenceLines.length === 0 ? (
                        <p className="text-sm text-zinc-400">No action evidence recorded yet.</p>
                      ) : (
                        <div className="space-y-2 max-w-[52ch]">
                          {evidenceLines.map((line, index) => (
                            <div
                              key={`evidence-${selectedRow.id}-${index}`}
                              className="rounded-lg border border-zinc-800/80 bg-zinc-950/70 px-2.5 py-2 text-sm text-zinc-300 break-words leading-6"
                            >
                              {line}
                            </div>
                          ))}
                        </div>
                      )}
                      <p className="mt-2 text-[11px] text-zinc-500">
                        SENT_TO_CHANNEL means the configured channel accepted the message. It is not human acknowledgement.
                      </p>
                    </div>

                    {detailViewMode === 'FULL' ? (
                      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                        <p className="text-[11px] text-zinc-500 mb-2">Captured details</p>
                        {view.detailLines.length === 0 ? (
                          <p className="text-sm text-zinc-400">No additional details available.</p>
                        ) : (
                          <div className="space-y-2 max-w-[52ch]">
                            {view.detailLines.map((line, index) => (
                              <div
                                key={`selected-${selectedRow.id}-${index}`}
                                className="rounded-lg border border-zinc-800/80 bg-zinc-950/70 px-2.5 py-2 text-sm text-zinc-300 break-words leading-6"
                              >
                                {renderLineWithEmailLinks(line, `selected-${selectedRow.id}-${index}`)}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                          <p className="text-[11px] text-zinc-500 mb-2">Structured details</p>
                          <div className="overflow-hidden rounded-lg border border-zinc-800/80 bg-zinc-950/70">
                            <table className="w-full border-collapse text-sm">
                              <tbody>
                                {structuredSections.map((section) => (
                                  <Fragment key={`${selectedRow.id}-${section.title}`}>
                                    <tr key={`${selectedRow.id}-${section.title}-heading`}>
                                      <td colSpan={2} className="bg-zinc-900/80 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                                        {section.title}
                                      </td>
                                    </tr>
                                    {section.rows.map((field, index) => (
                                      <tr key={`${selectedRow.id}-${section.title}-${field.label}-${index}`} className="border-t border-zinc-800/80">
                                        <td className="w-[38%] px-3 py-2 text-xs text-zinc-500 align-top">
                                          {field.label}
                                        </td>
                                        <td className="px-3 py-2 text-xs text-zinc-200 whitespace-pre-wrap break-words leading-5">
                                          {field.value}
                                        </td>
                                      </tr>
                                    ))}
                                  </Fragment>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                          <p className="text-[11px] text-zinc-500 mb-2">What this mode does</p>
                          <p className="text-xs leading-6 text-zinc-400">
                            Structured view uses a fixed schema for the current tab and fills missing fields with em dashes. Any extra metadata or custom fields appear in a separate section, so records can vary without breaking the layout.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
