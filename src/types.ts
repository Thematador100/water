export interface WaterMetric {
  name: string;
  value: number;
  unit: string;
  limit: number;
  healthGuideline?: number;
  timesExceeded?: number;
  description: string;
  status: 'safe' | 'warning' | 'danger';
}

export interface AuditReport {
  overallScore: number;
  summary: string;
  utilityName?: string;
  populationServed?: string;
  metrics: WaterMetric[];
  recommendations: string[];
  lastUpdated: string;
}

export const COMMON_CONTAMINANTS = [
  { id: 'ph', name: 'pH Level', unit: '', min: 6.5, max: 8.5 },
  { id: 'tds', name: 'Total Dissolved Solids', unit: 'mg/L', limit: 500 },
  { id: 'lead', name: 'Lead', unit: 'ppb', limit: 15 },
  { id: 'chlorine', name: 'Chlorine', unit: 'mg/L', limit: 4 },
  { id: 'fluoride', name: 'Fluoride', unit: 'mg/L', limit: 4 },
  { id: 'nitrates', name: 'Nitrates', unit: 'mg/L', limit: 10 },
  { id: 'arsenic', name: 'Arsenic', unit: 'ppb', limit: 10 },
  { id: 'microplastics', name: 'Microplastics', unit: 'particles/L', limit: 0, description: 'Emerging contaminant; no federal limit yet but health concerns exist.' },
];
