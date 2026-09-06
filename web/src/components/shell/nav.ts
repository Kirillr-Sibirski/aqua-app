/**
 * Primary navigation, in one place.
 *
 * `ready` is the switch: a route that does not exist yet is not rendered, because a nav link that
 * 404s is worse than a nav that is short. When the positions / builder / activity screens land,
 * flip the flag on their entry and nothing else changes. The bar hides the nav entirely while only
 * one destination is ready, so a single highlighted item never reads as a broken menu.
 */
export interface NavItem {
  href: string;
  /** Sentence case, one or two words, names the screen not the action. */
  label: string;
  /** Whether the route exists. */
  ready: boolean;
  /** '/' must match exactly; every other route also owns its children. */
  match: 'exact' | 'prefix';
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Overview', ready: true, match: 'exact' },
  { href: '/positions', label: 'Positions', ready: false, match: 'prefix' },
  { href: '/new', label: 'New position', ready: false, match: 'prefix' },
  { href: '/activity', label: 'Activity', ready: false, match: 'prefix' },
];

export function readyNavItems(): NavItem[] {
  return NAV_ITEMS.filter((item) => item.ready);
}

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.match === 'exact') return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
