/**
 * Turning a thrown thing into the two strings the UI actually shows.
 *
 * DESIGN.md's rule is "decoded custom error name, not 'something went wrong'". When a Strikeline
 * quote refuses, it refuses with `CoverageShortfall(uint256 required, uint256 available)` — the
 * name and the two numbers are the whole point of the guard, so throwing them away and printing
 * "transaction failed" would hide the only interesting thing on the screen.
 *
 * viem nests the decoded revert several layers down (`error.cause.cause.data.errorName`), and how
 * deep depends on which action wrapped it, so this walks the chain rather than reaching for a fixed
 * path. Nothing here imports viem: the shapes are read structurally, which keeps the primitive
 * library free of a chain dependency and works just as well on a plain `Error`.
 */

/** A user's own rejection is not a failure and should never be rendered as one. */
const REJECTION_NAMES = new Set(['UserRejectedRequestError', 'UserRejectedRequest']);

export interface DescribedError {
  /** The custom error name when one was decoded, else the error class name. */
  name?: string;
  /** One line, no stack, no ABI dump. */
  message: string;
  /** Decoded revert arguments, stringified. Empty when there were none. */
  args: string[];
  /** True when the wallet reports the person dismissed the request themselves. */
  rejected: boolean;
}

interface ErrorLike {
  name?: unknown;
  message?: unknown;
  shortMessage?: unknown;
  details?: unknown;
  cause?: unknown;
  data?: { errorName?: unknown; args?: unknown };
  metaMessages?: unknown;
}

function isRecord(value: unknown): value is ErrorLike {
  return typeof value === 'object' && value !== null;
}

/** Walk `cause` to the bottom, capped so a self-referential chain cannot spin. */
function chain(error: unknown): ErrorLike[] {
  const out: ErrorLike[] = [];
  let current = error;
  for (let i = 0; i < 8 && isRecord(current); i += 1) {
    out.push(current);
    current = current.cause;
  }
  return out;
}

function stringify(value: unknown): string {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * @example describeError(revert) // { name: 'CoverageShortfall', args: ['6000000000000000000', '5400000000000000000'], … }
 */
export function describeError(error: unknown): DescribedError {
  if (error === undefined || error === null) return { message: '', args: [], rejected: false };

  const links = chain(error);

  const rejected = links.some((l) => typeof l.name === 'string' && REJECTION_NAMES.has(l.name));

  // The deepest link carrying a decoded revert wins: that is the contract's own error, not the
  // action wrapper's restatement of it.
  const decoded = [...links].reverse().find((l) => typeof l.data?.errorName === 'string');

  const name =
    (decoded?.data?.errorName as string | undefined) ??
    links.map((l) => (typeof l.name === 'string' ? l.name : undefined)).find(Boolean);

  const args = Array.isArray(decoded?.data?.args) ? decoded.data.args.map(stringify) : [];

  const message =
    links.map((l) => (typeof l.shortMessage === 'string' ? l.shortMessage : undefined)).find(Boolean) ??
    links
      .map((l) => (typeof l.message === 'string' ? l.message.split('\n')[0] : undefined))
      .find(Boolean) ??
    String(error);

  return { name, message, args, rejected };
}
