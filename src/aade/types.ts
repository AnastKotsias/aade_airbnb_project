/**
 * AADE Portal Types and Interfaces
 * 
 * This module defines the core types for the AADE automation system.
 * Following the "Buffer Pattern" architecture from the senior engineer's plan.
 */

// ===== Booking Status Types =====
export type BookingStatus = 
  | 'PENDING'           // Ready for AADE submission
  | 'SUBMITTED'         // Successfully submitted to AADE
  | 'DRY_RUN_VERIFIED'  // Verified in dry-run mode (not actually submitted)
  | 'ERROR'             // Permanent error occurred
  | 'RETRY_LATER'       // Temporary error (maintenance, timeout)
  | 'NEEDS_PROPERTY'    // Property not registered in AADE
  | 'CANCELLED';        // Booking was cancelled

// ===== Portal Page States =====
export type AADEPageState = 
  | 'LOGIN'             // On login.gsis.gr
  | 'USER_INFO'         // User contact info form
  | 'PROPERTY_REGISTRY' // Main property list page
  | 'DECLARATIONS_LIST' // Declarations list for a property
  | 'NEW_DECLARATION'   // New declaration form
  | 'DECLARATION_SAVED' // Declaration saved confirmation
  | 'UNKNOWN';          // Unrecognized page

// ===== Booking Interface =====
export interface Booking {
  id: number;
  guest_name: string;
  check_in: string;        // YYYY-MM-DD format
  check_out: string;       // YYYY-MM-DD format
  total_payout: number;    // Amount in EUR
  platform_id: string;     // Confirmation code (e.g., HMXYZ12345)
  status: BookingStatus;
  audit_screenshot_path: string | null;
  is_cancelled: number;    // 0 or 1
  cancellation_date: string | null;
  created_at?: string;
}

// ===== Property Interface (from AADE registry) =====
export interface AADEProperty {
  index: number;           // Row index in the table
  propertyId?: string;     // AADE property ID if available
  address?: string;        // Property address
  description?: string;    // Property description
  hasDeclarations: boolean;
}

// ===== Form Field Configuration =====
export interface FormFieldConfig {
  /** Human-readable name for logging */
  name: string;
  /** Greek label text (for AI to find) */
  labelGreek: string;
  /** English label text (fallback) */
  labelEnglish: string;
  /** CSS selectors to try (optional, for direct access) */
  selectors?: string[];
  /** Field type for validation */
  type: 'text' | 'date' | 'number' | 'select';
  /** Whether this field is required */
  required: boolean;
}

// ===== Declaration Form Fields =====
export interface DeclarationFormConfig {
  /** Fields for the declaration form */
  fields: {
    arrivalDate: FormFieldConfig;
    departureDate: FormFieldConfig;
    totalRent: FormFieldConfig;
    cancellationAmount?: FormFieldConfig;
    cancellationDate?: FormFieldConfig;
    paymentMethod: FormFieldConfig;
    platform: FormFieldConfig;
  };
  /** Button labels for form actions */
  buttons: {
    submit: { greek: string; english: string };
    save: { greek: string; english: string };
    back: { greek: string; english: string };
    newDeclaration: { greek: string; english: string };
  };
}

// ===== Page Handler Result =====
export interface PageHandlerResult {
  success: boolean;
  nextState?: AADEPageState;
  error?: string;
  data?: Record<string, unknown>;
}

// ===== Agent Configuration =====
export interface AgentConfig {
  dryRun: boolean;
  slowMoMs: number;
  maxLoginWaitMs: number;
  screenshotOnAction: boolean;
  auditLogsDir: string;
}
