'use client';

/** A code block with a quiet copy button. The code is plain text at rest; the button only adds a shortcut. */
import { useState } from 'react';

export function CopyCode({ code, className, buttonClassName }: { code: string; className?: string; buttonClassName?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={className}>
      <button
        type="button"
        className={buttonClassName}
        onClick={() => {
          navigator.clipboard?.writeText(code).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            },
            () => {},
          );
        }}
        aria-label="Copy code"
      >
        {copied ? 'copied' : 'copy'}
      </button>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}
