'use client';

/**
 * The compiled leg, decoded and raw, side by side.
 *
 * `Aqua.ship` takes the strategy whole rather than pre-hashed, explicitly for data availability, so
 * `K`, `sigma`, `T` and `L` are public and any resolver can quote the position without an off-chain
 * book. That makes the bytes the agreement, and a maker about to sign them should be able to read
 * them. Hence both halves: a field-by-field decode, and the actual blob with each instruction's
 * byte run tinted so the four segments are visible in it.
 *
 * The decoder is `program.ts`, which walks `[opcode][len][args]` and knows our two opcodes by
 * number. It throws on a truncated program rather than showing a partial one, because a partial
 * decode on a review screen is a program that gets shipped anyway.
 */
import { useMemo } from 'react';
import { size, type Hex } from 'viem';
import { Card, CopyButton, ErrorState, Pill } from '@/components/ui';
import { cn } from '@/lib/ui';
import { explainProgram, type DecodedInstruction } from './program';

export interface ProgramInspectorProps {
  program: Hex;
  /** Shown above the bytes. The strategy hash, when the order it belongs to is known. */
  strategyHash?: Hex;
  title?: string;
  description?: string;
  /**
   * Render without the card frame, for an inspector already inside one. DESIGN.md rules out nested
   * cards, and `Card` degrades rather than nesting — this is the explicit form of that.
   */
  bare?: boolean;
  className?: string;
}

export function ProgramInspector({
  program,
  strategyHash,
  title = 'Compiled program',
  description = 'What Aqua stores, and what every quote runs. Four instructions, no fee among them.',
  bare = false,
  className,
}: ProgramInspectorProps) {
  const decoded = useMemo(() => {
    try {
      return { instructions: explainProgram(program), error: undefined };
    } catch (error) {
      return { instructions: [], error };
    }
  }, [program]);

  const bytes = size(program);

  if (decoded.error) {
    return bare ? (
      <ErrorState error={decoded.error} title="The program could not be decoded" bare className={className} />
    ) : (
      <Card title={title} className={className}>
        <ErrorState error={decoded.error} title="The program could not be decoded" bare />
      </Card>
    );
  }

  const body = (
    <>
      <ol className="flex flex-col">
        {decoded.instructions.map((instruction) => (
          <InstructionRow key={instruction.offset} instruction={instruction} />
        ))}
      </ol>

      <div className="mt-4 border-t border-line pt-4">
        <p className="text-mini text-ink-3">Raw bytes</p>
        <RawBytes instructions={decoded.instructions} />
      </div>
    </>
  );

  const footer = (
    <>
      <span className="font-mono tnum">
        {bytes} bytes · {decoded.instructions.length} instructions
      </span>
      {strategyHash ? (
        <span className="flex min-w-0 items-center gap-2">
          <span>strategyHash</span>
          <span className="truncate font-mono tnum text-ink-2">{strategyHash}</span>
        </span>
      ) : null}
    </>
  );

  if (bare) {
    return (
      <div className={className}>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 pb-3">
          <p className="max-w-prose text-mini leading-prose text-ink-3">{description}</p>
          <CopyButton value={program} what="program bytes" />
        </div>
        {body}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line pt-3 text-mini text-ink-3">
          {footer}
        </div>
      </div>
    );
  }

  return (
    <Card
      title={title}
      description={description}
      className={className}
      actions={<CopyButton value={program} what="program bytes" />}
      footer={footer}
    >
      {body}
    </Card>
  );
}

function InstructionRow({ instruction }: { instruction: DecodedInstruction }) {
  return (
    <li className="flex gap-3 border-b border-line py-3 last:border-b-0">
      <span className="w-10 shrink-0 pt-0.5 text-right font-mono text-mini tnum text-ink-3">
        {instruction.offset}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <code
            className={cn(
              'rounded-control px-1.5 py-0.5 font-mono text-mini tnum',
              instruction.custom ? 'bg-accent/15 text-accent' : 'bg-surface-2 text-ink-2',
            )}
          >
            0x{instruction.opcode.toString(16).padStart(2, '0')}
          </code>
          <span className="font-mono text-meta text-ink">{instruction.name}</span>
          {instruction.custom ? (
            <Pill tone="accent" size="sm">
              custom
            </Pill>
          ) : null}
          <span className="font-mono text-mini tnum text-ink-3">{instruction.byteLength} B</span>
        </div>

        {instruction.role ? (
          <p className="mt-1 max-w-prose text-mini leading-prose text-ink-3">{instruction.role}</p>
        ) : null}

        {instruction.fields.length > 0 ? (
          <dl className="mt-2 flex flex-col gap-1">
            {instruction.fields.map((field) => (
              <div key={field.name} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <dt className="w-28 shrink-0 font-mono text-mini text-ink-3">{field.name}</dt>
                <dd className="min-w-0 font-mono text-meta tnum break-all text-ink">{field.value}</dd>
                {field.note ? (
                  <dd className="w-full text-mini leading-prose text-ink-3 sm:w-auto sm:flex-1">
                    {field.note}
                  </dd>
                ) : null}
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </li>
  );
}

/**
 * The blob, with each instruction's run tinted.
 *
 * The two-byte `[opcode][len]` header of each instruction is dimmed and its arguments are not, so
 * the structure of the program is legible in the hex itself rather than only in the list above it.
 */
function RawBytes({ instructions }: { instructions: readonly DecodedInstruction[] }) {
  return (
    <p className="mt-2 font-mono text-mini tnum leading-prose break-all text-ink-2">
      <span className="text-ink-3">0x</span>
      {instructions.map((instruction) => {
        const body = instruction.bytes.slice(2);
        return (
          <span key={instruction.offset} title={`${instruction.name} @ ${instruction.offset}`}>
            <span className={instruction.custom ? 'text-accent/70' : 'text-ink-3'}>
              {body.slice(0, 4)}
            </span>
            <span className={instruction.custom ? 'text-accent' : 'text-ink-2'}>{body.slice(4)}</span>
          </span>
        );
      })}
    </p>
  );
}
