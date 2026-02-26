/**
 * AADE Module Index
 * 
 * Re-exports all AADE-related functionality for clean imports.
 */

// Types
export * from './types.js';

// Configuration
export * from './config.js';

// Page detection
export {
  detectPageState,
  isLoggedIn,
  hasMaintenanceMessage,
  hasSessionExpired,
  hasNoProperties,
  getStateDescription,
} from './pageDetector.js';

// Page handlers
export {
  handleUserInfoPage,
  handlePropertyRegistryPage,
  handleDeclarationsListPage,
  fillDeclarationForm,
  submitDeclaration,
  navigateToPropertyRegistry,
} from './handlers.js';
