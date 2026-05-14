const PRACTICE_AREA_LABELS: Record<string, string> = {
  commercial: 'Commercial',
  employment: 'Employment',
  privacy: 'Privacy',
  litigation: 'Litigation',
  corporate: 'Corporate',
  regulatory: 'Regulatory',
  ip: 'IP',
  real_estate: 'Real Estate',
  other: 'Other',
};

export function formatPracticeArea(area: string | null | undefined): string {
  if (!area) return '—';
  return PRACTICE_AREA_LABELS[area] ?? area;
}
