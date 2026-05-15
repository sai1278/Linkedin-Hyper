export interface DashboardRouteMeta {
  href: string;
  navLabel: string;
  pageTitle: string;
  description: string;
}

export const DASHBOARD_ROUTE_META = {
  dashboard: {
    href: '/',
    navLabel: 'Dashboard',
    pageTitle: 'Dashboard',
    description: 'Overview of your LinkedIn automation activity',
  },
  inbox: {
    href: '/inbox',
    navLabel: 'Inbox',
    pageTitle: 'Inbox',
    description: 'Unified conversations across your managed LinkedIn accounts',
  },
  connections: {
    href: '/connections',
    navLabel: 'Network',
    pageTitle: 'Network',
    description: 'Live LinkedIn connections plus recent tool activity across managed accounts',
  },
  notifications: {
    href: '/notifications',
    navLabel: 'Activity Log',
    pageTitle: 'Activity Log',
    description: 'Operational log of messages sent, connections sent, and profile views',
  },
  accounts: {
    href: '/accounts',
    navLabel: 'Accounts',
    pageTitle: 'Accounts',
    description: 'Manage LinkedIn account sessions and review their current state',
  },
  status: {
    href: '/status',
    navLabel: 'Status',
    pageTitle: 'Status',
    description: 'Operational health, startup validation, and deployment readiness',
  },
} satisfies Record<string, DashboardRouteMeta>;

const ROUTE_MATCH_ORDER: DashboardRouteMeta[] = [
  DASHBOARD_ROUTE_META.inbox,
  DASHBOARD_ROUTE_META.connections,
  DASHBOARD_ROUTE_META.notifications,
  DASHBOARD_ROUTE_META.accounts,
  DASHBOARD_ROUTE_META.status,
  DASHBOARD_ROUTE_META.dashboard,
];

export function getDashboardRouteMeta(pathname: string | null | undefined): DashboardRouteMeta {
  const normalized = String(pathname || '/').trim() || '/';
  return ROUTE_MATCH_ORDER.find((route) =>
    route.href === '/'
      ? normalized === '/'
      : normalized === route.href || normalized.startsWith(`${route.href}/`)
  ) || DASHBOARD_ROUTE_META.dashboard;
}

export const DASHBOARD_NAV_ITEMS = [
  DASHBOARD_ROUTE_META.inbox,
  DASHBOARD_ROUTE_META.connections,
  DASHBOARD_ROUTE_META.notifications,
  DASHBOARD_ROUTE_META.accounts,
  DASHBOARD_ROUTE_META.status,
] as const;
