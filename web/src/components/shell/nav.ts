/**
 * Primary navigation, in one place.
 *
 * `ready` is the switch: a route that does not exist yet is not rendered, because a nav link that
 * 404s is worse than a nav that is short. When the book / writer / activity screens land, flip the
 * flag on their entry and nothing else changes. The bar hides the nav entirely while only one
 * destination is ready, so a single highlighted item never reads as a broken menu.
 *
 * Labels are the words a person who has never traded an option would use. Aqua's own vocabulary is
 * ship and dock, and it is kept on the developer-facing surfaces, but the nav is not one of them:
 * a reader who cannot name the screen cannot get to it.
 */
export interface NavItem {
  href: string;
  /** Sentence case, three words at most, names the screen in words a newcomer already has. */
  label: string;
  /** Whether the route exists. */
  ready: boolean;
  /** '/' must match exactly; every other route also owns its children. */
  match: 'exact' | 'prefix';
}

/**
 * Market sits second, directly after Overview, because it is the only screen that shows something
 * without a wallet: every offer anyone has made, rebuilt from the chain's log. A visitor who lands
 * here with nothing connected has one destination that is not empty, and it should not be fourth.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Overview', ready: true, match: 'exact' },
  { href: '/surface', label: 'Market', ready: true, match: 'prefix' },
  { href: '/book', label: 'Offers', ready: true, match: 'prefix' },
  { href: '/write', label: 'Name a price', ready: true, match: 'prefix' },
  // Last, and one word on purpose: the bar is a fixed-height flex row that neither wraps nor shrinks,
  // so a fifth item is bought with header width. "Was it worth it" is the plainer label and it costs
  // about 40px more than this one, which is the difference between fitting and not fitting on a
  // narrow laptop. The question it answers is the page's own h1 instead.
  { href: '/receipt', label: 'Receipt', ready: true, match: 'prefix' },
  { href: '/activity', label: 'Activity', ready: false, match: 'prefix' },
];

export function readyNavItems(): NavItem[] {
  return NAV_ITEMS.filter((item) => item.ready);
}

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.match === 'exact') return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
