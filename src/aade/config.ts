/**
 * AADE Form Configuration
 * 
 * Configuration-driven approach for AADE form fields.
 * This makes it easy to update field labels if AADE changes their UI,
 * without modifying the core agent logic.
 */

import type { DeclarationFormConfig, FormFieldConfig, AgentConfig } from './types.js';

// ===== Declaration Form Field Configuration =====
export const DECLARATION_FORM_CONFIG: DeclarationFormConfig = {
  fields: {
    arrivalDate: {
      name: 'Arrival Date',
      labelGreek: 'Ημερομηνία Άφιξης',
      labelEnglish: 'Arrival Date',
      type: 'date',
      required: true,
    },
    departureDate: {
      name: 'Departure Date',
      labelGreek: 'Ημερομηνία Αναχώρησης',
      labelEnglish: 'Departure Date',
      type: 'date',
      required: true,
    },
    totalRent: {
      name: 'Total Rent',
      labelGreek: 'Συνολικό Συμφωνηθέν Μίσθωμα',
      labelEnglish: 'Total Agreed Rent',
      type: 'number',
      required: true,
    },
    cancellationAmount: {
      name: 'Cancellation Amount',
      labelGreek: 'Συνολικό Ποσό Ακύρωσης',
      labelEnglish: 'Total Cancellation Amount',
      type: 'number',
      required: false, // Only for cancelled bookings
    },
    cancellationDate: {
      name: 'Cancellation Date',
      labelGreek: 'Ημερομηνία Ακύρωσης',
      labelEnglish: 'Cancellation Date',
      type: 'date',
      required: false, // Only for cancelled bookings
    },
    paymentMethod: {
      name: 'Payment Method',
      labelGreek: 'Τρόπος Πληρωμής',
      labelEnglish: 'Payment Method',
      type: 'select',
      required: true,
    },
    platform: {
      name: 'Platform',
      labelGreek: 'Ηλεκτρονική Πλατφόρμα',
      labelEnglish: 'Electronic Platform',
      type: 'select',
      required: true,
    },
  },
  buttons: {
    submit: {
      greek: 'Υποβολή',
      english: 'Submit',
    },
    save: {
      greek: 'Αποθήκευση',
      english: 'Save',
    },
    back: {
      greek: 'Επιστροφή',
      english: 'Back',
    },
    newDeclaration: {
      greek: 'Νέα Δήλωση',
      english: 'New Declaration',
    },
  },
};

// ===== Payment Method Options =====
export const PAYMENT_METHODS = {
  ELECTRONIC_PLATFORM: {
    greek: 'Ηλεκτρονική Πλατφόρμα',
    english: 'Electronic Platform',
  },
  BANK_TRANSFER: {
    greek: 'Τραπεζική Μεταφορά',
    english: 'Bank Transfer',
  },
  CASH: {
    greek: 'Μετρητά',
    english: 'Cash',
  },
} as const;

// ===== Platform Options =====
export const PLATFORMS = {
  AIRBNB: {
    greek: 'Airbnb',
    english: 'Airbnb',
  },
  BOOKING_COM: {
    greek: 'Booking.com',
    english: 'Booking.com',
  },
  VRBO: {
    greek: 'VRBO',
    english: 'VRBO',
  },
  OTHER: {
    greek: 'Άλλο',
    english: 'Other',
  },
} as const;

// ===== Navigation Labels =====
export const NAV_LABELS = {
  propertyRegistry: {
    greek: 'Μητρώο Ακινήτων',
    english: 'Property Registry',
  },
  declarations: {
    greek: 'Δηλώσεις',
    english: 'Declarations',
  },
  addProperty: {
    greek: 'Εισαγωγή Ακινήτου',
    english: 'Add Property',
  },
  userInfo: {
    greek: 'Στοιχεία Χρήστη',
    english: 'User Info',
  },
} as const;

// ===== Portal Messages =====
export const PORTAL_MESSAGES = {
  noResults: {
    greek: 'Δεν βρέθηκαν αποτελέσματα',
    english: 'No results found',
  },
  maintenance: {
    greek: 'Συντήρηση',
    english: 'Maintenance',
  },
  sessionExpired: {
    greek: 'Η συνεδρία έληξε',
    english: 'Session expired',
  },
  successfulSubmission: {
    greek: 'Επιτυχής καταχώρηση',
    english: 'Successful submission',
  },
} as const;

// ===== Default Agent Configuration =====
export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  dryRun: true,
  slowMoMs: 100,
  maxLoginWaitMs: 5 * 60 * 1000, // 5 minutes
  screenshotOnAction: true,
  auditLogsDir: './audit_logs',
};

// ===== URL Patterns for Page Detection =====
export const URL_PATTERNS = {
  login: ['login.gsis.gr', 'oauth2'],
  userInfo: ['userInfo'],
  propertyRegistry: ['short_term_letting'],
  declarations: ['declarations', 'dilosi'],
  newDeclaration: ['newDeclaration', 'nea-dilosi'],
} as const;

/**
 * Helper to build an action instruction for Stagehand
 * Prefers Greek labels but falls back to English
 */
export function buildFieldInstruction(
  action: 'fill' | 'click' | 'select',
  field: FormFieldConfig,
  value?: string | number
): string {
  const labelPrimary = field.labelGreek;
  const labelFallback = field.labelEnglish;
  
  switch (action) {
    case 'fill':
      return `Fill the field labeled '${labelPrimary}' (or '${labelFallback}') with value: ${value}`;
    case 'click':
      return `Click on '${labelPrimary}' or '${labelFallback}'`;
    case 'select':
      return `Select '${value}' from the '${labelPrimary}' (or '${labelFallback}') dropdown`;
    default:
      return `Interact with '${labelPrimary}'`;
  }
}

/**
 * Helper to build button click instruction
 */
export function buildButtonInstruction(
  buttonKey: keyof DeclarationFormConfig['buttons']
): string {
  const button = DECLARATION_FORM_CONFIG.buttons[buttonKey];
  return `Click the '${button.greek}' or '${button.english}' button`;
}
