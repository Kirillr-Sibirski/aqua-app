'use client';

/**
 * The three states this page has before it has any rows, each with exactly one way out.
 *
 * The empty state is the only place on this screen a first-time reader can land, so it is the only
 * place that explains the product from nothing. It does it in the words the README opens with -- a
 * price, a date, the ETH never moving, the wait being paid for -- and then offers the single action
 * that resolves it. No feature list, no second button competing with the first.
 */
import { Button, Paper, Text, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ConnectModal } from '@/components/sell';

function Shell({ title, children, action }: { title: string; children: ReactNode; action: ReactNode }) {
  return (
    <Paper
      withBorder
      radius="xl"
      p="xl"
      bg="var(--surface)"
      style={{ borderColor: 'var(--line)', boxShadow: 'var(--shadow-card)' }}
      className="mx-auto w-full max-w-card"
    >
      <Title order={2} fz="var(--text-title)" c="var(--ink)">
        {title}
      </Title>
      <Text mt="sm" size="sm" c="var(--ink-2)" style={{ lineHeight: 'var(--leading-prose)' }}>
        {children}
      </Text>
      <div className="mt-6">{action}</div>
    </Paper>
  );
}

/**
 * No wallet. The offers exist on chain under an address; without one there is nothing to read.
 *
 * The button is the same control the header carries and opens the same picker; there is one wallet
 * UI in this app. It is `filled` here and `default` in the bar because this one is the only action
 * on the screen and that one sits beside a card whose own primary button must win.
 */
export function OffersDisconnected() {
  const [opened, { open, close }] = useDisclosure(false);
  return (
    <Shell
      title="Connect a wallet to see your offers"
      action={
        <>
          <Button size="md" onClick={open}>
            Connect wallet
          </Button>
          <ConnectModal opened={opened} onClose={close} />
        </>
      }
    >
      Your offers live on chain under your own address, not in a database beside this app. Connect a
      wallet and this page reads them back out of it — the terms, what your wallet can still hand
      over, and what past buyers have paid you.
    </Shell>
  );
}

/** A wallet, and nothing written from it yet. */
export function OffersNone() {
  return (
    <Shell
      title="You have not made an offer yet"
      action={
        <Button component={Link} href="/" size="md">
          Make an offer
        </Button>
      }
    >
      An offer names a price you would be happy to sell your ETH at, and a date. Your ETH never
      leaves your wallet: whoever eventually takes the offer pays you for the wait, and the longer
      nobody takes it the more the taker has to pay. Once you have one, this page shows the wallet
      standing behind it and what it has actually earned.
    </Shell>
  );
}
