export interface Driver {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone?: string;
  license_number: string;
  status: 'active' | 'inactive' | 'suspended';
  created_at: string;
}

// Liste gérée par l'admin (Paramètres > Types de service) ; un type archivé reste lisible dans l'historique.
export type ServiceType = string;

export interface ServiceTypeEntry {
  name: string;
  active: boolean;
}

/** Assignation planifiée (Calendrier) : rappel d'une course à faire, sans montant. */
export interface Assignment {
  id: string;
  driver_email: string;
  type: ServiceType;
  date: string; // ISO (date et heure prévues)
  description?: string;
  created_at?: string;
}

export interface Service {
  id: string;
  driver_email: string;
  type: ServiceType;
  amount: number;
  date: string; // ISO string
  description?: string;
  created_at: string;
  updated_at: string;
  /** Saisie hors ligne, pas encore envoyée au serveur. */
  pending?: boolean;
}

export interface MonthlyGoal {
  id: string;
  driver_email: string;
  year: number;
  month: number;
  revenue_goal: number;
  services_goal: number;
  created_at: string;
}

export interface AIConversation {
  id: string;
  driver_email: string;
  user_message: string;
  ai_response: string;
  context_data?: any;
  created_at: string;
}

export interface UserSession {
  mode?: 'demo';
  user: {
    id: string;
    email: string;
    name: string;
    role: 'admin' | 'chauffeur';
  };
}

export interface UserSettings {
  enableRAG: boolean;
}
