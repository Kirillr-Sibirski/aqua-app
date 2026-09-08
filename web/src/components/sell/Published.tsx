'use client';

/**
 * What happened, in the same card. No navigation.
 *
 * A page change after a transaction throws away the thing the person was looking at in order to
 * show them a version of it, and it costs the back button. So the card keeps its frame and swaps
 * its body: the offer is restated in the same words it was made in, with the hash of the
 * transaction that carried it, and one button back to the start.
 *
 * The `Transfer` count is the claim being checked rather than repeated. `ship` writes a virtual
 * balance and emits `Shipped` plus a `Pushed` per token; it performs no transfer and no balance
 * check. Every receipt's logs are scanned for the ERC-20 `Transfer` topic and the number is printed
 * — a publish that had moved tokens would say so here.
 */
import { Button, Text } from '@mantine/core';
import { CopyButton, Anchor } from '@mantine/core';
import { truncateHash } from '@/lib/ui';
import classes from './sell.module.css';
import type { PublishResult } from './usePublish';

export interface PublishedProps {
  result: PublishResult;
  /** The sentence the offer was made in, restated. */
  sentence: string;
  onAgain: () => void;
}

export function Published({ result, sentence, onAgain }: PublishedProps) {
  return (
    <div className={classes.result}>
      <Text size="md" fw={600} mb={2}>
        Your offer is live.
      </Text>
      <Text size="sm" c="dimmed" mb="sm" lh={1.45}>
        {sentence} It is a quote inside Aqua now, and anyone can take it. Nothing left your wallet.
      </Text>

      <div className={classes.resultRow}>
        <span className={classes.detailKey}>Transaction</span>
        <span className={classes.detailValue}>
          {result.shipHash ? truncateHash(result.shipHash) : '—'}
        </span>
      </div>
      <div className={classes.resultRow}>
        <span className={classes.detailKey}>Your offer</span>
        <span className={classes.detailValue}>{truncateHash(result.strategyHash)}</span>
      </div>
      <div className={classes.resultRow}>
        <span className={classes.detailKey}>Tokens moved</span>
        <span className={classes.detailValue}>
          {result.transfers} transfers across {result.hashes.length}{' '}
          {result.hashes.length === 1 ? 'transaction' : 'transactions'}
        </span>
      </div>

      {result.shipHash ? (
        <Text size="xs" mt={8}>
          <CopyButton value={result.shipHash}>
            {({ copied, copy }) => (
              <Anchor component="button" type="button" onClick={copy}>
                {copied ? 'Copied' : 'Copy the transaction hash'}
              </Anchor>
            )}
          </CopyButton>
        </Text>
      ) : null}

      <Button fullWidth size="md" radius="lg" variant="default" mt="md" onClick={onAgain}>
        Make another offer
      </Button>
    </div>
  );
}
