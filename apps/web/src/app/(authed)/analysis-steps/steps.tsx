import type { ReactNode } from 'react';
import { StepCard } from './StepCard';

interface PerMatterContent {
  step1?: ReactNode;
  step2?: ReactNode;
  step3?: ReactNode;
  step4?: ReactNode;
  step5?: ReactNode;
  step5b?: ReactNode;
  step6?: ReactNode;
  step7?: ReactNode;
  step8?: ReactNode;
}

export function AnalysisStepsContent({ perMatter }: { perMatter?: PerMatterContent } = {}) {
  return (
    <div className="space-y-4">
      <StepCard
        number="1"
        title="Pre-check the matter"
        whatItDoes={
          <p>
            Looks up the matter and decides whether to proceed. If the matter is already closed
            or cancelled, it stops. If the upstream triage hasn&apos;t yet produced a title and
            summary, it waits five seconds and tries again — because every downstream step reads
            from those fields.
          </p>
        }
        contextFrom={['The matter record in the database (status, title, summary)']}
        produces={<p>A decision: run, wait, or skip. Nothing is written.</p>}
        knobs={[
          'The retry delay (currently 5 seconds)',
          'Which matter statuses are skipped',
        ]}
        thisMatter={perMatter?.step1}
      />

      <StepCard
        number="2"
        title="Scan for red-flag phrases"
        whatItDoes={
          <p>
            Runs a fast keyword check over the request text, title, and summary, looking for
            phrases that should always get a senior lawyer&apos;s eye — things like &ldquo;consent
            decree,&rdquo; &ldquo;criminal,&rdquo; or &ldquo;regulator subpoena.&rdquo; This does
            not stop the analysis. It just sets a flag that gets checked at the end.
          </p>
        }
        contextFrom={[
          "The matter's request text, title, and summary",
          'A hard-coded list of trigger phrases maintained in the codebase',
        ]}
        produces={<p>A list of any triggers that fired and whether any of them are &ldquo;critical.&rdquo;</p>}
        knobs={[
          'The trigger phrase list itself (add new red flags, remove stale ones)',
          'Which triggers count as "critical"',
        ]}
        thisMatter={perMatter?.step2}
      />

      <StepCard
        number="3"
        title='Open an "analysis running" record'
        whatItDoes={
          <p>
            Creates a new row in the analysis log marked &ldquo;running.&rdquo; This is what
            powers the little &ldquo;Analysis running&rdquo; pill on the matter page so the
            lawyer can see something is happening.
          </p>
        }
        contextFrom={['Internal — no external context pulled']}
        produces={<p>An empty analysis record that the next steps fill in.</p>}
        knobs={['Nothing user-facing here. This is plumbing.']}
        thisMatter={perMatter?.step3}
      />

      <StepCard
        number="4"
        title="Stage 0: run the pre-merits checklist"
        whatItDoes={
          <>
            <p>
              Checks whether the matter raises the basic issues you&apos;d expect for its
              practice area. For a commercial matter, the checklist asks things like &ldquo;is
              there an indemnity cap?&rdquo;, &ldquo;who owns the IP?&rdquo;, &ldquo;are
              data-protection terms addressed?&rdquo; — one question per item.
            </p>
            <p className="mt-2">
              For each checklist item, the AI returns: raised, not raised, or can&apos;t tell —
              plus a confidence score, a quoted snippet from the request as evidence, and a
              one-sentence justification.
            </p>
          </>
        }
        contextFrom={[
          "The matter's request text, title, and summary",
          'A hard-coded checklist per practice area, maintained in the codebase',
          "The requesting organization's config (terminology rules, high-scrutiny jurisdictions)",
        ]}
        produces={
          <p>
            A scored checklist showing what was raised and what was missed, with quoted evidence
            for each finding.
          </p>
        }
        knobs={[
          'The checklist items themselves (add new questions, retire old ones, tune severity)',
          'The org-specific terminology and jurisdiction rules blended into the prompt',
          'The AI prompt that asks the model to grade each item',
        ]}
        thisMatter={perMatter?.step4}
      />

      <StepCard
        number="5"
        title="Stage 1: find similar guidance"
        whatItDoes={
          <>
            <p>
              Searches the Notion workspace for past matters, playbooks, or knowledge base
              articles that look like this matter — then asks the AI to grade each candidate on
              how well it actually fits.
            </p>
            <p className="mt-2">
              It runs three searches in parallel, using three different angles into the same
              workspace:
            </p>
            <ol className="mt-1 list-decimal pl-5 space-y-0.5">
              <li>The matter title</li>
              <li>The first twelve words of the AI-written summary</li>
              <li>The phrase &ldquo;[practice area] playbook&rdquo;</li>
            </ol>
            <p className="mt-2">
              Up to eight pages are pulled, deduplicated, and excerpts (the first 1,500
              characters of each) are sent to the AI alongside the matter facts.
            </p>
            <p className="mt-2">
              The AI scores each candidate on how on-point it is, jurisdiction match,
              fact-pattern overlap, and recency, and picks a verdict: matched, related, or no
              hit. If it&apos;s a match, the AI also drafts a &ldquo;headline answer&rdquo; — a
              one-line summary with a citation and link to the source page.
            </p>
            <p className="mt-2">
              Then a final re-ranking step adds a thumb-on-the-scale boost to candidates that
              are registered as authoritative playbooks (see Step 5b below).
            </p>
          </>
        }
        contextFrom={[
          'Notion, via one workspace-wide search — pulls from Saved Matters, Playbooks, and Knowledge Base in a single pool, no tree filtering',
          'The playbooks registry in the database, used only for the canon-tier boost',
        ]}
        produces={
          <ul className="list-disc pl-5 space-y-0.5">
            <li>A graded list of every candidate considered (audit trail)</li>
            <li>A top match, or &ldquo;no hit&rdquo;</li>
            <li>A headline answer with citation, when matched</li>
            <li>An overall confidence (high / medium / low)</li>
          </ul>
        }
        knobs={[
          'The three search queries (what angles into Notion the system uses)',
          'The number of candidates pulled (currently 8) and excerpt length (currently 1,500 chars)',
          'The canon-tier boost weights (currently +0.15 industry, +0.10 org, +0 draft)',
          'The grading prompt and which dimensions the AI scores on',
          'Which Notion trees are searchable (today, all of them — could be narrowed)',
        ]}
        thisMatter={perMatter?.step5}
      />

      <StepCard
        number="5b"
        title="The canon-tier boost (inside Step 5)"
        whatItDoes={
          <>
            <p>
              After the AI grades the candidates on raw merit, the system looks up each one in
              the playbooks registry to see if it&apos;s been tagged as authoritative — and if
              so, at what tier.
            </p>
            <ul className="mt-2 list-disc pl-5 space-y-0.5">
              <li>
                <strong>Industry tier</strong> — baseline guidance curated by humans — gets
                <strong> +0.15</strong>
              </li>
              <li>
                <strong>Org tier</strong> — guidance promoted because lawyers consistently
                accepted analyses that used it — gets <strong>+0.10</strong>
              </li>
              <li>
                <strong>Draft tier</strong> — proposed guidance, not yet validated — gets
                <strong> +0</strong>
              </li>
            </ul>
            <p className="mt-2">
              The candidate with the highest score after the boost becomes the surfaced top
              match. The verdict (matched / related / no hit) does <em>not</em> change — only
              which page wears the crown can.
            </p>
            <p className="mt-2 text-ink-600 dark:text-ink-400">
              <strong>Why it matters:</strong> drafts that prove themselves through real usage
              get promoted to org tier and start winning ties on future matters. Curating the
              playbook registry compounds.
            </p>
            <p className="mt-2 text-ink-600 dark:text-ink-400">
              <strong>Gotcha:</strong> Notion pages that are <em>not</em> registered as
              playbooks can still be retrieved and graded — but they get no boost. So a strong
              KB article competes on raw merit only. To make it reliably win against tier-tagged
              playbooks, promote it into the registry.
            </p>
          </>
        }
        contextFrom={[
          'The candidate list from Step 5',
          'The playbooks registry table (joined by Notion page ID)',
        ]}
        produces={
          <p>
            A re-ranked candidate list, and an audit log entry recording the boost and whether
            it changed the top pick. That entry feeds the daily M4 promote-playbooks job.
          </p>
        }
        knobs={[
          'The three boost weights (industry / org / draft)',
          'The promotion criteria the M4 job uses to move drafts up the tiers',
        ]}
        thisMatter={perMatter?.step5b}
      />

      <StepCard
        number="6"
        title="Compute the overall verdict"
        whatItDoes={
          <p>
            Combines Stage 0 (checklist) and Stage 1 (guidance match) into a single verdict for
            the matter. Overall confidence is the <em>worse</em> of the two stages, so a clean
            checklist with no matching guidance still ends up low-confidence. A matched playbook
            with a clean checklist → analysis complete. Anything else → analysis escalated, with
            a reason string explaining why.
          </p>
        }
        contextFrom={['The two stage outputs from Steps 4 and 5']}
        produces={
          <p>
            A final verdict (complete or escalated), an overall confidence level, and an
            escalation reason if applicable.
          </p>
        }
        knobs={[
          'The rule that takes the worse of the two stages (could be weighted, or one stage could dominate)',
          'The thresholds that decide complete vs. escalated',
        ]}
        thisMatter={perMatter?.step6}
      />

      <StepCard
        number="7"
        title="Escalate to senior review if needed"
        whatItDoes={
          <p>
            Checks the red-flag scan from Step 2. If any critical trigger fired, creates a
            &ldquo;senior review required&rdquo; escalation tied to this matter. Non-critical
            triggers are logged but don&apos;t auto-escalate.
          </p>
        }
        contextFrom={['The trigger flags set in Step 2']}
        produces={<p>A senior-review escalation record, if applicable.</p>}
        knobs={[
          'Which triggers escalate vs. only log',
          'Who senior-review escalations are routed to',
        ]}
        thisMatter={perMatter?.step7}
      />

      <StepCard
        number="8"
        title="Notify Slack"
        status="shadow"
        whatItDoes={
          <>
            <p>
              Posts a single message back into the matter&apos;s original Slack thread: the
              verdict, a count of high-severity flags, the headline answer (or escalation
              reason), and a link back to the matter page.
            </p>
            <p className="mt-2 text-ink-600 dark:text-ink-400">
              <strong>Status today:</strong> this step is suppressed while the pipeline runs in
              shadow mode. Everything else above still runs and records — only this final Slack
              message is held back. When shadow mode ends, this turns on automatically.
            </p>
          </>
        }
        contextFrom={['The analysis results from Steps 4–7']}
        produces={<p>One Slack message in the matter thread.</p>}
        knobs={[
          'The message format and which fields are included',
          'Whether to also DM the requester',
          'The link target (matter page, analysis trace, escalation page)',
        ]}
        thisMatter={perMatter?.step8}
      />
    </div>
  );
}

export function WhatItDoesNotDo() {
  return (
    <section className="bg-ink-50/60 dark:bg-ink-800/30 border border-ink-200 dark:border-ink-800 rounded-lg p-5">
      <h3 className="text-[15px] font-semibold text-ink-900 dark:text-ink-50 mb-2">
        What this pipeline does <em>not</em> do
      </h3>
      <p className="text-[13.5px] text-ink-700 dark:text-ink-300 mb-2">
        Three things people often assume happen automatically, but don&apos;t:
      </p>
      <ul className="space-y-1.5 text-[13.5px] text-ink-700 dark:text-ink-300 list-disc pl-5">
        <li>
          <strong>No statutory or case-law research.</strong> Those run only when a lawyer
          clicks the &ldquo;Statutory research&rdquo; or &ldquo;Case law&rdquo; button on the
          matter page.
        </li>
        <li>
          <strong>No counterparty or similar-matters lookup in the right rail.</strong> Those
          are handled by separate jobs at intake time, not by this pipeline.
        </li>
        <li>
          <strong>No document or clause analysis.</strong> Uploaded documents aren&apos;t read
          by any auto-step yet.
        </li>
      </ul>
    </section>
  );
}
