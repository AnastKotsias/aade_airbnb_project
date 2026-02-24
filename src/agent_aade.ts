import { Stagehand } from '@browserbasehq/stagehand';
import { getPendingBookings, updateStatus } from './db.js';
import { validateEnv, MODEL_CONFIG, ENV_MODE, DRY_RUN, SLOW_MO_MS } from './config.js';
import fs from 'fs';

// Validate required environment variables
validateEnv(['AADE_USERNAME', 'AADE_PASSWORD']);

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

async function main() {
  // Ensure audit logs directory exists
  if (!fs.existsSync('./audit_logs')) {
    fs.mkdirSync('./audit_logs');
  }

  // Initialize browser automation
  const stagehand = new Stagehand({
    env: ENV_MODE,
    verbose: 2,
    model: MODEL_CONFIG,
    localBrowserLaunchOptions: {
      headless: false,
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
    
    console.log("🔐 Logging in...");
    await stagehand.act("Click the 'Entry' or 'Είσοδος' button to log in");
    await stagehand.act(`Fill the username field with ${process.env.AADE_USERNAME}`);
    await stagehand.act(`Fill the password field with ${process.env.AADE_PASSWORD}`);
    await stagehand.act("Click the Login/Connect button");

    console.log(`⏳ Waiting for login to complete...`);
    await page.waitForLoadState('networkidle');
    await sleep(2000); // Give the page time to fully load
    
    // Process each booking
    for (const booking of bookings) {
      const cancelledTag = booking.is_cancelled ? ' (CANCELLED)' : '';
      console.log(`\n📝 Processing: ${booking.platform_id} - ${booking.guest_name}${cancelledTag}`);
      
      try {
        // Navigate to declaration form
        await stagehand.act("Click on 'Short Term Lease Declarations'");
        await sleep(SLOW_MO_MS);
        await stagehand.act("Click 'New Declaration'");
        await sleep(SLOW_MO_MS);
        
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