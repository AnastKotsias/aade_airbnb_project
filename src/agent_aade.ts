import { Stagehand } from '@browserbasehq/stagehand';
import { getPendingBookings, updateStatus } from './db.js';
import { validateEnv, MODEL_CONFIG, ENV_MODE, DRY_RUN, SLOW_MO_MS } from './config.js';
import fs from 'fs';

// Validate required environment variables (credentials no longer required - user enters manually)
validateEnv([]);

// Utilities
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface Booking {
  id: number;
  guest_name: string;
  check_in: string;
  check_out: string;
  total_payout: number;
  platform_id: string;
  status: string;
  audit_screenshot_path: string | null;
  is_cancelled: number;
  cancellation_date: string | null;
}

/**
 * Click the "ΣΥΝΕΧΕΙΑ" (Continue) button if it appears after form submission
 * AADE shows this confirmation page after saving contact info
 */
async function clickContinueButtonIfPresent(page: any): Promise<void> {
  try {
    // Look for Continue button in Greek or English
    const continueButton = page.locator('button:has-text("ΣΥΝΕΧΕΙΑ"), button:has-text("Continue"), a:has-text("ΣΥΝΕΧΕΙΑ"), input[value*="ΣΥΝΕΧΕΙΑ"]').first();
    const exists = await continueButton.isVisible().catch(() => false);
    
    if (exists) {
      console.log("📍 Found 'ΣΥΝΕΧΕΙΑ' (Continue) button - clicking...");
      await continueButton.click();
      await sleep(1500);
    }
  } catch {
    // No continue button, proceed
  }
}

/**
 * Check if we're on the User Info page (contact details required by AADE)
 * IMPORTANT: AADE requires contact info to proceed - cannot be skipped!
 * Clicking "Cancel" will log you out. We must fill the form to continue.
 * 
 * For testing (DRY_RUN=true): Uses placeholder values that won't affect real submissions
 * For production: Should use real contact info from environment variables
 */
async function handleUserInfoPageIfPresent(stagehand: Stagehand, page: any): Promise<boolean> {
  const currentUrl = page.url();
  
  // Check if we're on the userInfo page
  if (!currentUrl.includes('userInfo')) {
    return false; // Not on user info page
  }
  
  console.log("📋 Detected User Info page - AADE requires contact details to proceed");
  console.log("⚠️  Note: Clicking 'Cancel' would log you out. Filling required fields...");
  
  // Use environment variables or test placeholders
  const phone = process.env.AADE_PHONE || '2101234567';
  const mobile = process.env.AADE_MOBILE || '6971234567';  
  const email = process.env.AADE_EMAIL || 'test@example.com';
  
  try {
    // Use Playwright directly for more reliable form filling on this old gov site
    // The textboxes are in a specific order: Telephone, Mobile, Email
    const telephoneInput = page.locator('input[type="text"]').first();
    const mobileInput = page.locator('input[type="text"]').nth(1);
    const emailInput = page.locator('input[type="text"]').nth(2);
    
    // Clear and fill each field
    await telephoneInput.click();
    await telephoneInput.fill(phone);
    await sleep(200);
    
    await mobileInput.click();
    await mobileInput.fill(mobile);
    await sleep(200);
    
    await emailInput.click();
    await emailInput.fill(email);
    await sleep(200);
    
    console.log(`📝 Filled contact info: Phone=${phone}, Mobile=${mobile}, Email=${email}`);
    
    // Click Save button using Playwright locator (more reliable than LLM)
    const saveButton = page.locator('button:has-text("Αποθήκευση"), button:has-text("Save")').first();
    await saveButton.click();
    
    await sleep(2000);
    
    // After saving, AADE might show a "ΣΥΝΕΧΕΙΑ" (Continue) confirmation page
    await clickContinueButtonIfPresent(page);
    
    console.log("✅ Contact info saved, continuing to declarations...");
    
    return true;
  } catch (error) {
    console.log("⚠️  Could not fill form with Playwright, trying Stagehand...");
    
    // Fallback to Stagehand if direct Playwright fails
    await stagehand.act(`Type ${phone} in the Telephone field`);
    await sleep(300);
    await stagehand.act(`Type ${mobile} in the Mobile field`);
    await sleep(300);
    await stagehand.act(`Type ${email} in the Email field`);
    await sleep(300);
    await stagehand.act("Click the Save button");
    await sleep(2000);
    
    // After saving, AADE might show a "ΣΥΝΕΧΕΙΑ" (Continue) confirmation page
    await clickContinueButtonIfPresent(page);
    
    return true;
  }
}

/**
 * Dismiss any language selection popup that appears on AADE portal
 */
async function dismissLanguagePopupIfPresent(stagehand: Stagehand, page: any): Promise<void> {
  await sleep(1000); // Wait for popup to appear
  
  try {
    // Check if there's a language selection popup and dismiss it by selecting Greek
    const greekButton = page.locator('text=Ελληνικά').first();
    const hasPopup = await greekButton.isVisible().catch(() => false);
    
    if (hasPopup) {
      console.log("🌐 Language popup detected - selecting Greek...");
      await greekButton.click();
      await sleep(500);
    }
  } catch {
    // No popup, continue
  }
}

async function main() {
  // Ensure audit logs directory exists
  if (!fs.existsSync('./audit_logs')) {
    fs.mkdirSync('./audit_logs');
  }

  // Initialize browser automation with password manager disabled
  const stagehand = new Stagehand({
    env: ENV_MODE,
    verbose: 2,
    model: MODEL_CONFIG,
    localBrowserLaunchOptions: {
      headless: false,
      args: [
        '--disable-save-password-bubble',        // Disable password save prompts
        '--disable-translate',                    // Disable translation prompts
      ],
    },
    browserbaseSessionCreateParams: {
      // For Browserbase, use these settings
      browserSettings: {
        blockAds: true,
      },
    },
    ...(ENV_MODE === 'BROWSERBASE' && {
      apiKey: process.env.BROWSERBASE_API_KEY!,
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
    }),
  });

  await stagehand.init();
  
  const page = stagehand.context.pages()[0];
  if (!page) {
    throw new Error("Failed to get browser page");
  }
  
  // Fetch pending bookings from database
  const bookings = getPendingBookings.all() as Booking[];
  if (bookings.length === 0) {
    console.log("✅ No pending bookings to submit.");
    await stagehand.close();
    return;
  }

  console.log(`📋 Found ${bookings.length} pending booking(s) to process\n`);

  try {
    // Navigate to AADE portal and login
    console.log("🌐 Navigating to AADE portal...");
    await page.goto("https://www1.gsis.gr/taxisnet/short_term_letting/");
    await sleep(1500);
    
    // Dismiss language popup if it appears
    await dismissLanguagePopupIfPresent(stagehand, page);
    
    console.log("🔐 Opening login page...");
    await stagehand.act("Click the 'Entry' or 'Είσοδος' button to log in");
    await sleep(500);
    
    // Wait for user to manually enter credentials and login
    console.log("\n" + "═".repeat(60));
    console.log("👤 MANUAL LOGIN REQUIRED");
    console.log("═".repeat(60));
    console.log("Please enter your AADE credentials in the browser and click Login.");
    console.log("The agent will continue automatically once you're logged in...");
    console.log("═".repeat(60) + "\n");
    
    // Wait for the user to complete login (check for URL change away from login page)
    // Poll every 2 seconds for up to 5 minutes
    const maxWaitTime = 5 * 60 * 1000; // 5 minutes
    const pollInterval = 2000;
    let elapsed = 0;
    
    while (elapsed < maxWaitTime) {
      await sleep(pollInterval);
      elapsed += pollInterval;
      
      const currentUrl = page.url();
      // Check if we're no longer on the login page
      if (!currentUrl.includes('login.gsis.gr') && !currentUrl.includes('oauth2')) {
        console.log("✅ Login detected! Continuing...");
        break;
      }
      
      // Show a dot every 10 seconds to indicate we're waiting
      if (elapsed % 10000 === 0) {
        process.stdout.write(".");
      }
    }
    
    if (elapsed >= maxWaitTime) {
      throw new Error("Login timeout - user did not complete login within 5 minutes");
    }

    console.log(`⏳ Waiting for page to fully load...`);
    // Use domcontentloaded instead of networkidle (more reliable for gov sites)
    await page.waitForLoadState('domcontentloaded');
    await sleep(3000); // Give the page time to fully load after login
    
    // Handle User Info page if AADE redirects there after login
    const wasOnUserInfoPage = await handleUserInfoPageIfPresent(stagehand, page);
    
    // If we just saved contact info, wait for redirect and reload state
    if (wasOnUserInfoPage) {
      await page.waitForLoadState('domcontentloaded');
      await sleep(2000);
    }
    
    // Verify we're logged in and on the main page (not login page)
    const currentUrl = page.url();
    if (currentUrl.includes('login.gsis.gr') || currentUrl.includes('osso_logout')) {
      throw new Error("Login failed or session expired. Please check credentials.");
    }
    
    console.log("✅ Successfully logged in to AADE portal");
    
    // Process each booking
    for (const booking of bookings) {
      const cancelledTag = booking.is_cancelled ? ' (CANCELLED)' : '';
      console.log(`\n📝 Processing: ${booking.platform_id} - ${booking.guest_name}${cancelledTag}`);
      
      try {
        // First, ensure we're on the main AADE page (navigate there if needed)
        if (!page.url().includes('short_term_letting')) {
          console.log("🔄 Navigating back to AADE main page...");
          await page.goto("https://www1.gsis.gr/taxisnet/short_term_letting/");
          await page.waitForLoadState('domcontentloaded');
          await sleep(2000);
        }
        
        // Try to find and click the declarations link using Playwright first
        console.log("📋 Looking for Short Term Lease Declarations link...");
        
        // Look for the link by text content (more reliable than LLM on this site)
        const declarationsLink = page.locator('a:has-text("Δηλώσεις"), a:has-text("Declarations")').first();
        const linkExists = await declarationsLink.isVisible().catch(() => false);
        
        if (linkExists) {
          await declarationsLink.click();
          await sleep(1500);
        } else {
          // Fallback to Stagehand if Playwright can't find it
          await stagehand.act("Click on 'Δηλώσεις Βραχυχρόνιας Μίσθωσης' or 'Short Term Lease Declarations' link in the menu");
          await sleep(SLOW_MO_MS);
        }
        
        // Click New Declaration button
        console.log("➕ Looking for New Declaration button...");
        const newDeclButton = page.locator('button:has-text("Νέα Δήλωση"), button:has-text("New Declaration"), a:has-text("Νέα Δήλωση")').first();
        const buttonExists = await newDeclButton.isVisible().catch(() => false);
        
        if (buttonExists) {
          await newDeclButton.click();
          await sleep(1500);
        } else {
          await stagehand.act("Click 'Νέα Δήλωση' or 'New Declaration' button");
          await sleep(SLOW_MO_MS);
        }
        
        // Fill booking dates
        await stagehand.act(`Fill 'Arrival Date' with ${booking.check_in}`);
        await sleep(SLOW_MO_MS);
        await stagehand.act(`Fill 'Departure Date' with ${booking.check_out}`);
        await sleep(SLOW_MO_MS);
        
        // Fill payment details (different fields for cancelled vs active)
        if (booking.is_cancelled) {
          await stagehand.act(`Fill 'Total amount received under cancellation policy' with ${booking.total_payout}`);
          await stagehand.act(`Fill 'Cancelation Date' with ${booking.cancellation_date}`);
        } else {
          await stagehand.act(`Fill 'Total agreed rent' with ${booking.total_payout}`);
        }
        
        // Select payment method
        await stagehand.act("Select 'Electronic Platform' from Payment Method");
        await stagehand.act("Select 'Airbnb' from the Electronic Platform list");

        // Capture audit screenshot before submission
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const screenshotPath = `audit_logs/evidence_${booking.platform_id}_${timestamp}.png`;
        await page.screenshot({ path: screenshotPath });
        console.log(`📸 Screenshot saved: ${screenshotPath}`);
        
        // Submit or dry-run
        if (DRY_RUN) {
           console.log("🔍 DRY RUN: Skipping submission, marking as verified");
           updateStatus.run({ 
             status: 'DRY_RUN_VERIFIED', 
             screenshot: screenshotPath,
             id: booking.id 
           });
           await stagehand.act("Click the 'Back' or 'Επιστροφή' button to cancel and return to the list");
           console.log("✅ Dry run complete");
        } else {
           console.log("🚀 PRODUCTION: Submitting to AADE...");
           await stagehand.act("Click the final Submit/Finalize button");
           await page.waitForLoadState('networkidle');
           
           updateStatus.run({ 
             status: 'DONE', 
             screenshot: screenshotPath,
             id: booking.id 
           });
           
           await stagehand.act("Click the button to return to the declarations list");
           console.log("✅ Submitted successfully");
        }

      } catch (bookingError: unknown) {
        const errorMsg = bookingError instanceof Error ? bookingError.message : String(bookingError);
        console.error(`❌ Error: ${errorMsg}`);
        
        // Differentiate between maintenance and permanent errors
        const isMaintenanceError = errorMsg.toLowerCase().includes('maintenance') ||
                                   errorMsg.toLowerCase().includes('συντήρηση') ||
                                   errorMsg.toLowerCase().includes('unavailable');
        
        const status = isMaintenanceError ? 'RETRY_LATER' : 'ERROR';
        if (isMaintenanceError) {
          console.log(`⚠️  System maintenance - will retry later`);
        }
        
        updateStatus.run({ status, screenshot: null, id: booking.id });
        
        // Reset to main page for next booking
        await page.goto("https://www1.gsis.gr/taxisnet/short_term_letting/"); 
      }
    }

    console.log(`\n✅ All bookings processed`);

  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("\n❌ Critical error (login/navigation):", errorMsg);
  } finally {
    console.log("\n🔒 Closing browser...");
    await stagehand.close();
  }
}

main();