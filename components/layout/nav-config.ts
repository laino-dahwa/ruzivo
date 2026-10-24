import {
  CircleDollarSign,
  FileBarChart,
  FileSignature,
  Landmark,
  LayoutDashboard,
  Receipt,
  Scale,
  ShieldAlert,
  UserRoundSearch,
  Users,
  Wallet,
} from 'lucide-react';
import type { Capability } from '../../lib/auth/permissions';

export type NavGroup = 'money' | 'people' | 'school';

/** Shown as a small heading above each cluster in the sidebar. */
export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  money: 'Money',
  people: 'People',
  school: 'School',
};

/** The order groups appear in. */
export const NAV_GROUP_ORDER: NavGroup[] = ['money', 'people', 'school'];

export type NavItem = {
  href: string;
  label: string;
  icon: typeof Users;
  capability: Capability;
  /** Ungrouped items sit above the first heading. Only Overview does. */
  group?: NavGroup;
};

/**
 * `capability` is what the sidebar filters on, so somebody only ever sees
 * links to pages they can actually open. The same capability gates the page
 * itself (lib/auth/page-guard.ts) and its API routes (lib/auth/guard.ts) —
 * hiding a link is a courtesy, not the control.
 *
 * Labels are deliberately short and plain. "Balances" and "Expected fees"
 * used to be "Owing" and "Unpaid Mandatory", which nobody could tell apart
 * without clicking: the first is money already charged and still outstanding,
 * the second is money learners are expected to pay whether or not they have
 * started. Array order is display order.
 */
export const nav: NavItem[] = [
  { href: '/', label: 'Overview', icon: LayoutDashboard, capability: 'overview.view' },

  { href: '/payments', label: 'Payments', icon: CircleDollarSign, capability: 'payment.read', group: 'money' },
  { href: '/owing', label: 'Balances', icon: Scale, capability: 'balance.read', group: 'money' },
  { href: '/unpaid-mandatory', label: 'Expected fees', icon: ShieldAlert, capability: 'obligation.read', group: 'money' },
  { href: '/learner-owings', label: 'Learner owings', icon: UserRoundSearch, capability: 'obligation.read', group: 'money' },
  { href: '/expenses', label: 'Expenses', icon: Receipt, capability: 'expense.read', group: 'money' },

  { href: '/learners', label: 'Learners', icon: Users, capability: 'learner.read', group: 'people' },
  { href: '/payroll', label: 'Payroll', icon: Wallet, capability: 'payroll.manage', group: 'people' },

  { href: '/statements', label: 'Documents', icon: FileSignature, capability: 'document.manage', group: 'school' },
  { href: '/reports', label: 'Reports', icon: FileBarChart, capability: 'report.read', group: 'school' },
  { href: '/school', label: 'Setup', icon: Landmark, capability: 'school.manage', group: 'school' },
];

/**
 * Below this many visible links, headings are more clutter than help — a
 * cashier sees six, which takes in at a glance without being sorted into
 * piles. Keyed off the count rather than the role so it stays right if
 * permissions ever move.
 */
export const GROUPING_THRESHOLD = 7;
