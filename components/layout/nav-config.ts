import {
  CircleDollarSign,
  FileBarChart,
  Landmark,
  LayoutDashboard,
  Receipt,
  Scale,
  Users,
} from 'lucide-react';

export const nav = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/school', label: 'School setup', icon: Landmark },
  { href: '/learners', label: 'Learners', icon: Users },
  { href: '/payments', label: 'Payments', icon: CircleDollarSign },
  { href: '/owing', label: 'Owing', icon: Scale },
  { href: '/expenses', label: 'Expenses', icon: Receipt },
  { href: '/reports', label: 'Reports', icon: FileBarChart },
];
