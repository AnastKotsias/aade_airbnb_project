/**
 * AADE Page State Detector
 * 
 * Determines which page/state we're currently on in the AADE portal.
 * This is crucial for the state machine approach - we need to know
 * where we are before deciding what to do next.
 */

import type { Page } from '@browserbasehq/stagehand';
import type { AADEPageState } from './types.js';
import { URL_PATTERNS, PORTAL_MESSAGES } from './config.js';

/**
 * Detect the current page state based on URL and page content
 */
export async function detectPageState(page: Page): Promise<AADEPageState> {
  const currentUrl = page.url();
  
  // Check URL patterns first (fastest)
  if (matchesAnyPattern(currentUrl, URL_PATTERNS.login)) {
    return 'LOGIN';
  }
  
  if (matchesAnyPattern(currentUrl, URL_PATTERNS.userInfo)) {
    return 'USER_INFO';
  }
  
  if (matchesAnyPattern(currentUrl, URL_PATTERNS.newDeclaration)) {
    return 'NEW_DECLARATION';
  }
  
  if (matchesAnyPattern(currentUrl, URL_PATTERNS.declarations)) {
    return 'DECLARATIONS_LIST';
  }
  
  // For property registry, also check page content
  if (matchesAnyPattern(currentUrl, URL_PATTERNS.propertyRegistry)) {
    // Check if we're on the main property registry by looking for specific elements
    const hasPropertyTable = await page
      .locator('table, .property-list, [class*="registry"]')
      .first()
      .isVisible()
      .catch(() => false);
    
    if (hasPropertyTable) {
      return 'PROPERTY_REGISTRY';
    }
  }
  
  // Check for saved confirmation page
  const hasSavedMessage = await page
    .locator(`text=${PORTAL_MESSAGES.successfulSubmission.greek}`)
    .isVisible()
    .catch(() => false);
  
  if (hasSavedMessage) {
    return 'DECLARATION_SAVED';
  }
  
  return 'UNKNOWN';
}

/**
 * Check if URL matches any of the given patterns
 */
function matchesAnyPattern(url: string, patterns: readonly string[]): boolean {
  return patterns.some(pattern => url.includes(pattern));
}

/**
 * Check if user is logged in (not on login page)
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  const currentUrl = page.url();
  return !matchesAnyPattern(currentUrl, URL_PATTERNS.login);
}

/**
 * Check if there's a system maintenance message
 */
export async function hasMaintenanceMessage(page: Page): Promise<boolean> {
  const greekCheck = await page
    .locator(`text=${PORTAL_MESSAGES.maintenance.greek}`)
    .isVisible()
    .catch(() => false);
  
  const englishCheck = await page
    .locator(`text=${PORTAL_MESSAGES.maintenance.english}`)
    .isVisible()
    .catch(() => false);
  
  return greekCheck || englishCheck;
}

/**
 * Check if session has expired
 */
export async function hasSessionExpired(page: Page): Promise<boolean> {
  const currentUrl = page.url();
  
  // Check URL for logout/expired indicators
  if (currentUrl.includes('osso_logout') || currentUrl.includes('expired')) {
    return true;
  }
  
  // Check page content
  const hasExpiredMessage = await page
    .locator(`text=${PORTAL_MESSAGES.sessionExpired.greek}`)
    .isVisible()
    .catch(() => false);
  
  return hasExpiredMessage;
}

/**
 * Check if there are no properties registered
 */
export async function hasNoProperties(page: Page): Promise<boolean> {
  return await page
    .locator(`text=${PORTAL_MESSAGES.noResults.greek}`)
    .isVisible()
    .catch(() => false);
}

/**
 * Get page state description for logging
 */
export function getStateDescription(state: AADEPageState): string {
  const descriptions: Record<AADEPageState, string> = {
    LOGIN: 'TaxisNet Login Page',
    USER_INFO: 'User Contact Information Form',
    PROPERTY_REGISTRY: 'Property Registry (Main Page)',
    DECLARATIONS_LIST: 'Declarations List for Property',
    NEW_DECLARATION: 'New Declaration Form',
    DECLARATION_SAVED: 'Declaration Saved Confirmation',
    UNKNOWN: 'Unknown Page',
  };
  
  return descriptions[state];
}
