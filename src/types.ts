export type Kind = 'artist' | 'movie' | 'place';

export interface Pick {
  entity_id: string;
  name: string;
  kind: Kind;
  role: 'headliner' | 'support' | 'opener' | 'screening' | 'food';
  tags: string[];
  affinity: number | null;
  score: number;
  feeInr: number;
  why: string;
  seeds?: string[];
  rank?: number;
  slot: string;
  label: string;
  time: string;
  stage: string;
  blurb?: string | null;
}

export interface Check {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
}

export interface Plan {
  lineup: Pick[];
  totals: {
    feeInr: number;
    budgetInr: number;
    remainingInr: number;
    spendRatio: number;
    avgAffinity: number;
    artistTags: string[];
    cuisines: string[];
  };
  checks: Check[];
  warnings: string[];
  headline: string;
  generatedAt: string;
  solver: { combosChecked: number; ms: number };
}

export interface TraceStep {
  id: string;
  title: string;
  status: 'ok' | 'warn' | 'error';
  detail: string;
  chips: string[];
  ms: number;
}

export interface Meta {
  mode: 'live' | 'demo';
  note: string | null;
  location: string;
  budgetInr: number;
  maxPerTag: number;
  seeds: { query: string; resolved: string; kind: Kind }[];
  unresolved: string[];
  calls: number;
  toolCalls: number;
  cacheHits: number;
  failures: number;
  candidateCounts: { artists: number; movies: number; places: number };
  solverMs: number;
  feasibilityChecks: number;
}

export interface Diff {
  changes: {
    slot: string;
    label: string;
    name: string;
    status: 'kept' | 'changed' | 'new';
    previous?: string;
  }[];
  dropped: { slot: string; label: string; name: string }[];
}

export interface PlanResponse {
  plan?: Plan;
  trace: TraceStep[];
  meta: Meta;
  error?: string;
  diff?: Diff;
  replanned?: boolean;
  action?: string;
}
