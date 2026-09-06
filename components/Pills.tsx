import { STAGE_LABELS, type CaseStage, type DocumentStatus, type RiskRating } from '@/lib/rules/types';

export function StagePill({ stage }: { stage: CaseStage }) {
  return <span className={`pill stage-${stage}`}>{STAGE_LABELS[stage]}</span>;
}

export function RiskPill({ risk }: { risk: RiskRating }) {
  return <span className={`pill risk-${risk}`}>{risk.charAt(0).toUpperCase() + risk.slice(1)}</span>;
}

export function DocumentStatusPill({ status }: { status: DocumentStatus }) {
  return (
    <span className={`pill ${status === 'verified' ? 'risk-low' : 'risk-high'}`}>
      {status === 'verified' ? 'Verified' : 'Missing'}
    </span>
  );
}

export function FlagStatePill({ enabled }: { enabled: boolean }) {
  return (
    <span className={`pill ${enabled ? 'risk-low' : ''}`}>{enabled ? 'On' : 'Off'}</span>
  );
}

export function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(value);
}
