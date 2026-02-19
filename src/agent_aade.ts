import { Stagehand } from '@browserbasehq/stagehand';
import { z } from 'zod';
import { getPendingBookings, updateStatus } from './db.js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

interface Booking {
  id: number;
  guest_name: string;
  check_in: string;
  check_out: string;
  total_payout: number;
  platform_id: string;
  status: string;
  audit_screenshot_path: string | null;
  created_at: string;
}

async function main() {
  if (!fs.existsSync('./audit_logs')) {
    fs.mkdirSync('./audit_logs');
  }

  // 1. Initialize Stagehand v3
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    apiKey: process.env.BROWSERBASE_API_KEY!,
    projectId: process.env.BROWSERBASE_PROJECT_ID!,
    // Note: 'headless' is removed. Use Browserbase Live View to watch the session.
  });

  await stagehand.init();
  
  // Access the page via the context in v3
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
    
    // AI methods (act, extract, observe) are now on the stagehand instance
    await stagehand.act("Click the 'Entry' or 'Είσοδος' button to log in");
    await stagehand.act(`Fill the username field with ${process.env.AADE_USERNAME}`);
    await stagehand.act(`Fill the password field with ${process.env.AADE_PASSWORD}`);
    await stagehand.act("Click the Login/Connect button");

    console.log("Waiting 10s for manual checks (OTP/User Selection)...");
    await new Promise(resolve => setTimeout(resolve, 10000));

    for (const booking of bookings) {
      console.log(`Processing booking for: ${booking.guest_name}`);

      await stagehand.act("Click on the 'Short Term Lease Declarations' or 'Δηλώσεις Βραχυχρόνιας Διαμονής' link");
      await stagehand.act("Click the button to submit a 'New Declaration' or 'Υποβολή Νέας Δήλωσης'");
      
      await stagehand.act(`Fill the 'Arrival Date' or 'Άφιξη' with ${booking.check_in}`);
      await stagehand.act(`Fill the 'Departure Date' or 'Αναχώρηση' with ${booking.check_out}`);
      await stagehand.act(`Fill the 'Total agreed rent' or 'Συνολικό συμφωνηθέν μίσθωμα' with ${booking.total_payout}`);
      await stagehand.act("Select 'Electronic Platform' or 'Ηλεκτρονική πλατφόρμα' from the Payment Method dropdown");
      await stagehand.act("Select 'Airbnb' from the Electronic Platform list");

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const screenshotPath = `audit_logs/evidence_${booking.platform_id}_${timestamp}.png`;
      await page.screenshot({ path: screenshotPath });
      
      console.log(`Audit log saved: ${screenshotPath}`);
      console.log("DRY RUN: Skipping final submit button click.");

      updateStatus.run({ 
        status: 'DONE', 
        screenshot: screenshotPath,
        id: booking.id 
      });
      
      await stagehand.act("Click the 'Back' or 'Επιστροφή' button to return to the list");
    }

  } catch (error) {
    console.error("Agent crashed:", error);
  } finally {
    await stagehand.close();
  }
}

main();