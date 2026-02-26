/**
 * AADE Page Handlers
 * 
 * Modular handlers for each AADE portal page/state.
 * Each handler knows how to interact with its specific page
 * and what the expected next state should be.
 */

import type { Stagehand, Page } from '@browserbasehq/stagehand';
import type { 
  PageHandlerResult, 
  AADEProperty, 
  Booking, 
  AgentConfig 
} from './types.js';
import { 
  DECLARATION_FORM_CONFIG, 
  PAYMENT_METHODS, 
  PLATFORMS,
  NAV_LABELS,
  buildFieldInstruction,
  buildButtonInstruction,
} from './config.js';
import { detectPageState, hasNoProperties } from './pageDetector.js';

// Utility for delays
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Handle the User Info page (contact details form)
 * AADE requires this to be filled - clicking Cancel logs you out!
 */
export async function handleUserInfoPage(
  stagehand: Stagehand,
  page: Page,
  config: AgentConfig
): Promise<PageHandlerResult> {
  console.log("📋 Handling User Info page - AADE requires contact details");
  
  // Get contact info from environment or use test values
  const phone = process.env.AADE_PHONE || '2101234567';
  const mobile = process.env.AADE_MOBILE || '6971234567';
  const email = process.env.AADE_EMAIL || 'test@example.com';
  
  try {
    // Try direct Playwright approach first (more reliable for old gov sites)
    const inputs = page.locator('input[type="text"]');
    const inputCount = await inputs.count();
    
    if (inputCount >= 3) {
      await inputs.nth(0).fill(phone);
      await sleep(200);
      await inputs.nth(1).fill(mobile);
      await sleep(200);
      await inputs.nth(2).fill(email);
      await sleep(200);
      
      console.log(`📝 Filled: Phone=${phone}, Mobile=${mobile}, Email=${email}`);
    } else {
      // Fallback to Stagehand
      await stagehand.act(`Type ${phone} in the Telephone field`);
      await sleep(config.slowMoMs);
      await stagehand.act(`Type ${mobile} in the Mobile field`);
      await sleep(config.slowMoMs);
      await stagehand.act(`Type ${email} in the Email field`);
      await sleep(config.slowMoMs);
    }
    
    // Click Save button
    const saveButton = page.locator('button:has-text("Αποθήκευση"), button:has-text("Save")').first();
    const saveExists = await saveButton.isVisible().catch(() => false);
    
    if (saveExists) {
      await saveButton.click();
    } else {
      await stagehand.act("Click the Save button");
    }
    
    await sleep(2000);
    
    // Check for Continue button after save
    const continueButton = page.locator('button:has-text("ΣΥΝΕΧΕΙΑ"), a:has-text("ΣΥΝΕΧΕΙΑ")').first();
    const continueExists = await continueButton.isVisible().catch(() => false);
    
    if (continueExists) {
      console.log("📍 Clicking 'ΣΥΝΕΧΕΙΑ' (Continue) button...");
      await continueButton.click();
      await sleep(1500);
    }
    
    console.log("✅ Contact info saved successfully");
    
    return {
      success: true,
      nextState: 'PROPERTY_REGISTRY',
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("❌ Failed to fill user info:", errorMsg);
    
    return {
      success: false,
      error: `Failed to fill contact info: ${errorMsg}`,
    };
  }
}

/**
 * Handle the Property Registry page
 * Either select an existing property or detect that none exist
 */
export async function handlePropertyRegistryPage(
  stagehand: Stagehand,
  page: Page,
  config: AgentConfig
): Promise<PageHandlerResult> {
  console.log("🏠 Handling Property Registry page...");
  
  // Check if there are no properties registered
  if (await hasNoProperties(page)) {
    console.log("⚠️  No properties registered in AADE");
    
    return {
      success: false,
      error: 'NO_PROPERTIES_REGISTERED',
      data: {
        needsPropertyRegistration: true,
        instructions: [
          "You need to register a property in AADE before making declarations.",
          `Click '${NAV_LABELS.addProperty.greek}' to add your Airbnb property.`,
          "After registering, run the agent again.",
        ],
      },
    };
  }
  
  // Find properties in the table
  const properties = await discoverProperties(page);
  
  if (properties.length === 0) {
    console.log("⚠️  Could not find properties in the table");
    return {
      success: false,
      error: 'PROPERTIES_NOT_FOUND',
    };
  }
  
  console.log(`📋 Found ${properties.length} registered property(ies)`);
  
  // For now, select the first property
  // TODO: Add property matching logic based on listing ID
  const selectedProperty = properties[0]!;
  console.log(`🏠 Selecting property #${selectedProperty.index + 1}`);
  
  // Click on Declarations link for this property
  const declarationsLink = page.locator('a:has-text("Δηλώσεις"), button:has-text("Δηλώσεις")').first();
  const linkExists = await declarationsLink.isVisible().catch(() => false);
  
  if (linkExists) {
    await declarationsLink.click();
    await sleep(2000);
  } else {
    await stagehand.act(
      `In the property table, click the '${NAV_LABELS.declarations.greek}' link ` +
      `in the Actions column for property row ${selectedProperty.index + 1}`
    );
    await sleep(2000);
  }
  
  return {
    success: true,
    nextState: 'DECLARATIONS_LIST',
    data: { selectedProperty },
  };
}

/**
 * Discover properties from the AADE registry table
 */
async function discoverProperties(page: Page): Promise<AADEProperty[]> {
  const properties: AADEProperty[] = [];
  
  try {
    // Find all rows in the property table
    const rows = page.locator('table tbody tr, .property-row');
    const rowCount = await rows.count();
    
    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i);
      const isVisible = await row.isVisible().catch(() => false);
      
      if (isVisible) {
        // Check if this row has a Declarations link by looking at the row's text content
        const rowText = await row.textContent().catch(() => '');
        const hasDeclarationsLink = rowText?.includes('Δηλώσεις') || false;
        
        properties.push({
          index: i,
          hasDeclarations: hasDeclarationsLink,
        });
      }
    }
  } catch (error) {
    console.warn("⚠️  Error discovering properties:", error);
  }
  
  return properties;
}

/**
 * Handle the Declarations List page
 * Navigate to create a new declaration
 */
export async function handleDeclarationsListPage(
  stagehand: Stagehand,
  page: Page,
  config: AgentConfig
): Promise<PageHandlerResult> {
  console.log("📋 Handling Declarations List page...");
  
  // Click New Declaration button
  const newDeclButton = page.locator(
    `button:has-text("${DECLARATION_FORM_CONFIG.buttons.newDeclaration.greek}"), ` +
    `button:has-text("${DECLARATION_FORM_CONFIG.buttons.newDeclaration.english}"), ` +
    `a:has-text("${DECLARATION_FORM_CONFIG.buttons.newDeclaration.greek}")`
  ).first();
  
  const buttonExists = await newDeclButton.isVisible().catch(() => false);
  
  if (buttonExists) {
    console.log("➕ Clicking New Declaration button...");
    await newDeclButton.click();
    await sleep(1500);
  } else {
    console.log("🤖 Using AI to find New Declaration button...");
    await stagehand.act(buildButtonInstruction('newDeclaration'));
    await sleep(config.slowMoMs);
  }
  
  return {
    success: true,
    nextState: 'NEW_DECLARATION',
  };
}

/**
 * Fill the declaration form with booking data
 */
export async function fillDeclarationForm(
  stagehand: Stagehand,
  page: Page,
  booking: Booking,
  config: AgentConfig
): Promise<PageHandlerResult> {
  console.log(`📝 Filling declaration form for ${booking.guest_name}...`);
  
  const fields = DECLARATION_FORM_CONFIG.fields;
  
  try {
    // Fill arrival date
    console.log(`   📅 Arrival: ${booking.check_in}`);
    await stagehand.act(buildFieldInstruction('fill', fields.arrivalDate, booking.check_in));
    await sleep(config.slowMoMs);
    
    // Fill departure date
    console.log(`   📅 Departure: ${booking.check_out}`);
    await stagehand.act(buildFieldInstruction('fill', fields.departureDate, booking.check_out));
    await sleep(config.slowMoMs);
    
    // Fill payment details based on cancellation status
    if (booking.is_cancelled && fields.cancellationAmount && fields.cancellationDate) {
      console.log(`   💸 Cancellation amount: €${booking.total_payout}`);
      await stagehand.act(
        buildFieldInstruction('fill', fields.cancellationAmount, booking.total_payout)
      );
      await sleep(config.slowMoMs);
      
      if (booking.cancellation_date) {
        console.log(`   📅 Cancellation date: ${booking.cancellation_date}`);
        await stagehand.act(
          buildFieldInstruction('fill', fields.cancellationDate, booking.cancellation_date)
        );
        await sleep(config.slowMoMs);
      }
    } else {
      console.log(`   💰 Total rent: €${booking.total_payout}`);
      await stagehand.act(buildFieldInstruction('fill', fields.totalRent, booking.total_payout));
      await sleep(config.slowMoMs);
    }
    
    // Select payment method: Electronic Platform
    console.log(`   💳 Payment method: Electronic Platform`);
    await stagehand.act(
      buildFieldInstruction('select', fields.paymentMethod, PAYMENT_METHODS.ELECTRONIC_PLATFORM.greek)
    );
    await sleep(config.slowMoMs);
    
    // Select platform: Airbnb
    console.log(`   🏠 Platform: Airbnb`);
    await stagehand.act(buildFieldInstruction('select', fields.platform, PLATFORMS.AIRBNB.greek));
    await sleep(config.slowMoMs);
    
    return {
      success: true,
      data: { formFilled: true },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("❌ Failed to fill form:", errorMsg);
    
    return {
      success: false,
      error: `Form filling failed: ${errorMsg}`,
    };
  }
}

/**
 * Submit or save the declaration (respects dry-run mode)
 */
export async function submitDeclaration(
  stagehand: Stagehand,
  page: Page,
  booking: Booking,
  config: AgentConfig,
  screenshotPath: string
): Promise<PageHandlerResult> {
  if (config.dryRun) {
    console.log("🔍 DRY RUN: Form filled but not submitted");
    
    // Click back/cancel to return without submitting
    await stagehand.act(buildButtonInstruction('back'));
    await sleep(1000);
    
    return {
      success: true,
      data: {
        submitted: false,
        dryRun: true,
        screenshotPath,
      },
    };
  }
  
  // Production mode: Actually submit
  console.log("🚀 PRODUCTION: Submitting declaration to AADE...");
  
  try {
    await stagehand.act(buildButtonInstruction('submit'));
    await page.waitForLoadState('domcontentloaded');
    await sleep(2000);
    
    // Verify submission was successful
    const newState = await detectPageState(page);
    
    if (newState === 'DECLARATION_SAVED' || newState === 'DECLARATIONS_LIST') {
      console.log("✅ Declaration submitted successfully");
      
      return {
        success: true,
        nextState: newState,
        data: {
          submitted: true,
          screenshotPath,
        },
      };
    }
    
    // Check for error messages
    const hasError = await page
      .locator('.error, .alert-danger, [class*="error"]')
      .isVisible()
      .catch(() => false);
    
    if (hasError) {
      return {
        success: false,
        error: 'Submission error detected on page',
      };
    }
    
    return {
      success: true,
      data: { submitted: true, screenshotPath },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Submission failed: ${errorMsg}`,
    };
  }
}

/**
 * Navigate back to property registry from any page
 */
export async function navigateToPropertyRegistry(
  stagehand: Stagehand,
  page: Page
): Promise<void> {
  const url = page.url();
  
  if (!url.includes('short_term_letting')) {
    console.log("🔄 Navigating to AADE Property Registry...");
    await page.goto('https://www1.gsis.gr/taxisnet/short_term_letting/');
    await page.waitForLoadState('domcontentloaded');
    await sleep(2000);
  }
}
