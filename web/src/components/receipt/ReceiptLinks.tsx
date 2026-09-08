'use client';

/**
 * The two links off the bottom of the receipt.
 *
 * Their own module, and the only client island on this page, purely because Mantine's `component`
 * prop takes a component: a server component cannot hand `Link` across the RSC boundary
 * ("Functions cannot be passed directly to Client Components"). The receipt itself stays a server
 * component, so the whole comparison — every table, every uncomfortable row — is in the HTML before
 * a line of JavaScript runs; only these two anchors hydrate.
 */
import Link from 'next/link';
import { Button, Group } from '@mantine/core';

export function ReceiptLinks() {
  return (
    <Group gap="sm">
      <Button component={Link} href="/" variant="filled" color="petrol" size="sm">
        Name your own price
      </Button>
      <Button component={Link} href="/surface" variant="default" size="sm">
        See every live offer
      </Button>
    </Group>
  );
}
