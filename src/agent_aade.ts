import { Stagehand } from '@browserbasehq/stagehand';
import { getPendingBookings, updateStatus } from './db.js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const DRY_RUN = process.env.DRY_RUN !== 'false';
const ENV_MODE = (process.env.STAGEHAND_ENV || 'LOCAL') as 'LOCAL' | 'BROWSERBASE';

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
  if (!fs.existsSync('./audit_logs')) fs.mkdirSync('./audit_logs');

  const stagehand = new Stagehand({
    env: ENV_MODE,
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
  
  const bookings = getPendingBookings.all() as Booking[];
  if (bookings.length === 0) {
    console.log("No pending bookings to submit.");
    await stagehand.close();
    return;
  }

  try {
    console.log("Navigating to AADE...");
    await page.goto("https://www1.gsis.gr/taxisnet/short_term_letting/");
    
    await stagehand.act("Click the 'Entry' or 'Είσοδος' button to log in");
    await stagehand.act(`Fill the username field with ${process.env.AADE_USERNAME}`);
    await stagehand.act(`Fill the password field with ${process.env.AADE_PASSWORD}`);
    await stagehand.act("Click the Login/Connect button");

    console.log(`⚠️ Check Browserbase Live View. Waiting up to 3 mins for manual OTP/2FA if required...`);
    await page.waitForLoadState('networkidle', 180000); 
    
    for (const booking of bookings) {
      const cancelledTag = booking.is_cancelled ? ' (CANCELLED)' : '';
      console.log(`Processing booking: ${booking.platform_id} for ${booking.guest_name}${cancelledTag}`);
      
      try {
        await stagehand.act("Click on 'Short Term Lease Declarations'");
        await stagehand.act("Click 'New Declaration'");
        
        await stagehand.act(`Fill 'Arrival Date' with ${booking.check_in}`);
        await stagehand.act(`Fill 'Departure Date' with ${booking.check_out}`);
        
        if (booking.is_cancelled) {
          await stagehand.act(`Fill 'Total amount received under cancellation policy' with ${booking.total_payout}`);
          await stagehand.act(`Fill 'Cancelation Date' with ${booking.cancellation_date}`);
        } else {
          await stagehand.act(`Fill 'Total agreed rent' with ${booking.total_payout}`);
        }
        
        await stagehand.act("Select 'Electronic Platform' from Payment Method");
        await stagehand.act("Select 'Airbnb' from the Electronic Platform list");

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const screenshotPath = `audit_logs/evidence_${booking.platform_id}_${timestamp}.png`;
        await page.screenshot({ path: screenshotPath });
        
        if (DRY_RUN) {
           console.log("DRY RUN: Skipping final submit button. Navigating back.");
           await stagehand.act("Click the 'Back' or 'Επιστροφή' button to cancel and return to the list");
        } else {
           console.log("PRODUCTION: Clicking submit...");
           await stagehand.act("Click the final Submit/Finalize button");
           await page.waitForLoadState('networkidle');
           
           updateStatus.run({ 
             status: 'DONE', 
             screenshot: screenshotPath,
             id: booking.id 
           });
           
           await stagehand.act("Click the button to return to the declarations list");
        }

      } catch (bookingError) {
        console.error(`❌ Failed processing booking ${booking.platform_id}:`, bookingError);
        updateStatus.run({ status: 'ERROR', screenshot: null, id: booking.id });
        await page.goto("https://www1.gsis.gr/taxisnet/short_term_letting/"); 
      }
    }

  } catch (error) {
    console.error("Agent crashed during critical path (Login):", error);
  } finally {
    await stagehand.close();
  }
}

main();