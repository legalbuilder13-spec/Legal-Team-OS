import { AnalysisStepsContent, WhatItDoesNotDo } from './steps';

export const metadata = {
  title: 'Analysis Steps · Legal Team OS',
};

export default function AnalysisStepsPage() {
  return (
    <div className="max-w-4xl">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-ink-900 dark:text-ink-50">Analysis Steps</h1>
        <p className="mt-2 text-[14px] text-ink-600 dark:text-ink-400 max-w-2xl leading-relaxed">
          A plain-English walkthrough of every step the pre-review analysis pipeline takes on a
          matter — what it does, where it pulls context from, what it produces, and what an
          admin could change. Use this to understand how the tool is reasoning today and to
          spot opportunities for future tuning.
        </p>
      </header>

      <AnalysisStepsContent />

      <div className="mt-8">
        <WhatItDoesNotDo />
      </div>

      <footer className="mt-10 text-[12px] text-ink-500 dark:text-ink-400 border-t border-ink-200 dark:border-ink-800 pt-4">
        See a per-matter version of this walkthrough on any matter page, in the &ldquo;How this
        analysis ran&rdquo; panel.
      </footer>
    </div>
  );
}
