import type { ThresholdItem } from '../analysis.js';

// PRD §7.5 + §8 — litigation pre-merits checklist. Threshold issues
// that can dispose of a litigation matter before merits analysis
// (Steel Co. ordering). Heavy on jurisdiction, standing, immunity,
// preclusion.

export const LITIGATION_THRESHOLDS_VERSION = '1.0.0';

export const LITIGATION_THRESHOLDS: ThresholdItem[] = [
  {
    id: 'subject_matter_jurisdiction',
    prompt:
      'Subject-matter jurisdiction. Is there a basis (federal question, diversity with > $75K + complete diversity, supplemental, removal)? SMJ defects can be raised at any time and dispose of the case.',
    severityIfRaised: 'high',
    docAnchor: 'how-lawyers-think.md Part VI §6.6',
  },
  {
    id: 'personal_jurisdiction',
    prompt:
      'Personal jurisdiction. Minimum contacts under International Shoe / Daimler / Bristol-Myers. General vs. specific jurisdiction. Targeted at the defendant + arising-out-of test.',
    severityIfRaised: 'high',
  },
  {
    id: 'venue',
    prompt:
      'Venue. Proper venue under 28 U.S.C. § 1391 (federal) or state long-arm. Transfer under § 1404(a) / forum non conveniens.',
    severityIfRaised: 'medium',
  },
  {
    id: 'standing',
    prompt:
      'Article III standing. Injury in fact + causation + redressability under Lujan. Generalized grievance, taxpayer, and prudential standing limits.',
    severityIfRaised: 'high',
  },
  {
    id: 'ripeness_mootness',
    prompt:
      'Ripeness / mootness / political question. Is the dispute concrete + ongoing? Capable of repetition yet evading review?',
    severityIfRaised: 'medium',
  },
  {
    id: 'sovereign_immunity',
    prompt:
      'Sovereign immunity. Eleventh Amendment (state defendants), federal sovereign immunity (FTCA waiver), foreign sovereign immunity (FSIA).',
    severityIfRaised: 'high',
  },
  {
    id: 'res_judicata',
    prompt:
      'Claim preclusion / issue preclusion. Same claim previously litigated to final judgment between same parties (or privies). Issue actually litigated + necessarily decided.',
    severityIfRaised: 'high',
  },
  {
    id: 'limitations_repose',
    prompt:
      'Statute of limitations / statute of repose. Accrual rule, discovery rule, equitable tolling, fraudulent concealment. Repose periods are absolute even if undiscovered.',
    severityIfRaised: 'high',
  },
  {
    id: 'arbitration_forum_selection',
    prompt:
      'Arbitration / forum-selection clauses. FAA-governed agreements compel arbitration absent specific defenses. Class-action waivers, delegation clauses (Henry Schein).',
    severityIfRaised: 'high',
  },
  {
    id: 'qualified_immunity',
    prompt:
      'Qualified immunity (§ 1983 / Bivens cases). Clearly established law at time of conduct. Saucier two-step (now Pearson discretion).',
    severityIfRaised: 'medium',
  },
  {
    id: 'class_certification',
    prompt:
      'Class certification prerequisites under Rule 23 (numerosity, commonality, typicality, adequacy) + 23(b) type. Wal-Mart v. Dukes / Comcast scrutiny on commonality + damages model.',
    severityIfRaised: 'medium',
  },
  {
    id: 'pleading_plausibility',
    prompt:
      'Twombly / Iqbal plausibility on key elements. Are scienter, causation, or knowledge pleaded with enough factual detail to survive a 12(b)(6) motion?',
    severityIfRaised: 'medium',
  },
];
