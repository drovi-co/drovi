export interface SimulationOverridePayload {
  commitment_delays?: Record<string, number>;
  commitment_cancellations?: string[];
}

export interface SimulationSnapshot {
  open_commitments: number;
  overdue_commitments: number;
  at_risk_commitments: number;
  risk_score: number;
  risk_outlook: string;
}

export interface SimulationSensitivity {
  commitment_id: string;
  change_type: "delay" | "cancel";
  delta_risk_score: number;
  delta_overdue: number;
}

export interface SimulationResult {
  simulation_id: string;
  scenario_name: string;
  baseline: SimulationSnapshot;
  simulated: SimulationSnapshot;
  delta: Record<string, unknown>;
  sensitivity: SimulationSensitivity[];
  narrative: string;
}
