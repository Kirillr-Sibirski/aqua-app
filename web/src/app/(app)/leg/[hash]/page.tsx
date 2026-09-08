import { permanentRedirect } from 'next/navigation';

/**
 * `/leg/[hash]` -> `/offer/[hash]`.
 *
 * The screen moved when the vocabulary did: *leg* is one of the words the comprehension study found
 * readers could not guess, and the route is part of what a person reads. The old path stays as a
 * permanent redirect because a strategy hash is a public, stable identifier — anything that ever
 * linked to one of these, inside the app or outside it, keeps working.
 */
export default async function LegRedirect({ params }: PageProps<'/leg/[hash]'>) {
  const { hash } = await params;
  permanentRedirect(`/offer/${hash}`);
}
