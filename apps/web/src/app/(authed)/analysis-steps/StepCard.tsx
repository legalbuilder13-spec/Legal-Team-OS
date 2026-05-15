import type { ReactNode } from 'react';

interface StepCardProps {
  number: string;
  title: string;
  whatItDoes: ReactNode;
  contextFrom: string[];
  produces: ReactNode;
  knobs: string[];
  thisMatter?: ReactNode;
  status?: 'live' | 'shadow' | 'static';
}

export function StepCard({
  number,
  title,
  whatItDoes,
  contextFrom,
  produces,
  knobs,
  thisMatter,
  status,
}: StepCardProps) {
  return (
    <section className="bg-white dark:bg-ink-900 border border-ink-200 dark:border-ink-800 rounded-lg overflow-hidden">
      <header className="px-5 py-3 border-b border-ink-100 dark:border-ink-800 bg-ink-50/50 dark:bg-ink-800/30 flex items-center gap-3">
        <span className="inline-flex h-7 min-w-[1.75rem] px-2 items-center justify-center rounded-md bg-brand-600 text-white text-xs font-semibold font-mono">
          {number}
        </span>
        <h3 className="text-[15px] font-semibold text-ink-900 dark:text-ink-50">{title}</h3>
        {status === 'shadow' && (
          <span className="ml-auto text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-amber-200 text-amber-700 dark:border-amber-900 dark:text-amber-300">
            currently muted
          </span>
        )}
      </header>

      <div className="px-5 py-4 space-y-4">
        <Field label="What it does">{whatItDoes}</Field>

        <Field label="Where the context comes from">
          <ul className="space-y-1 text-[13.5px] text-ink-700 dark:text-ink-300 list-disc pl-5">
            {contextFrom.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </Field>

        <Field label="What it produces">{produces}</Field>

        <Field label="Knobs an admin could change">
          <ul className="space-y-1 text-[13.5px] text-ink-700 dark:text-ink-300 list-disc pl-5">
            {knobs.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </Field>

        {thisMatter !== undefined && (
          <div className="border-l-2 border-brand-500 bg-brand-50/60 dark:bg-brand-950/30 pl-3 pr-3 py-2 rounded-r">
            <div className="text-[11px] font-medium uppercase tracking-wider text-brand-700 dark:text-brand-300 mb-1">
              This matter
            </div>
            <div className="text-[13.5px] text-ink-800 dark:text-ink-200">{thisMatter}</div>
          </div>
        )}
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wider text-ink-500 dark:text-ink-400 mb-1.5">
        {label}
      </div>
      <div className="text-[13.5px] text-ink-700 dark:text-ink-300 leading-relaxed">
        {children}
      </div>
    </div>
  );
}
