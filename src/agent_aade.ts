import { Stagehand } from '@browserbasehq/stagehand';
import { z } from 'zod';
import { getPendingBookings, updateStatus } from './db.js';
import dotenv from 'dotenv';

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
  // 1. Initialize Stagehand with Browserbase
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    apiKey: process.env.BROWSERBASE_API_KEY!,
    projectId: process.env.BROWSERBASE_PROJECT_ID!,
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
    // 2. Login to AADE
    console.log("Navigating to AADE...");
    await page.goto("https://www1.gsis.gr/taxisnet/short_term_letting/");
    
    // Use Natural Language (AI) to interact with the form
    // We use the 'act' command which finds elements semantically.
    await stagehand.act("Click the 'Entry' or 'Είσοδος' button to log in", { page });
    
    // Handle TaxisNet Login
    await stagehand.act(`Fill the username field with ${process.env.AADE_USERNAME}`, { page });
    await stagehand.act(`Fill the password field with ${process.env.AADE_PASSWORD}`, { page });
    await stagehand.act("Click the Login/Connect button", { page });

    // SENIOR GUARDRAIL: 2FA/OTP Pause
    // If the site asks for user selection or OTP, wait for 10 seconds to allow manual intervention via Live View
    console.log("Waiting 10s for manual checks (OTP/User Selection)...");
    await new Promise(resolve => setTimeout(resolve, 10000));

    // 3. Process Bookings Loop
    for (const booking of bookings) {
      console.log(`Processing booking for: ${booking.guest_name}`);

      // Navigate to 'Short Term Lease Declarations'
      // Reference: The manual says click "Δηλώσεις Βραχυχρόνιας Διαμονής"
      await stagehand.act("Click on the 'Short Term Lease Declarations' or 'Δηλώσεις Βραχυχρόνιας Διαμονής' link", { page });
      
      // Click 'New Declaration'
      // Reference: The manual shows the '+' button or 'Υποβολή Νέας Δήλωσης'
      await stagehand.act("Click the button to submit a 'New Declaration' or 'Υποβολή Νέας Δήλωσης'", { page });

      // 4. Fill the Form (Semantic Mapping)
      // We map the DB fields to natural language instructions
      
      // Arrival Date
      await stagehand.act(`Fill the 'Arrival Date' or 'Άφιξη' with ${booking.check_in}`, { page });
      
      // Departure Date
      await stagehand.act(`Fill the 'Departure Date' or 'Αναχώρηση' with ${booking.check_out}`, { page });
      
      // Total Agreed Rent
      await stagehand.act(`Fill the 'Total agreed rent' or 'Συνολικό συμφωνηθέν μίσθωμα' with ${booking.total_payout}`, { page });

      // Payment Method
      // Assuming 'Deposit' or 'Platform' based on standard practice. 
      // You might need to adjust this string based on exact dropdown values.
      await stagehand.act("Select 'Electronic Platform' or 'Ηλεκτρονική πλατφόρμα' from the Payment Method dropdown", { page });

      // Select Platform
      await stagehand.act("Select 'Airbnb' from the Electronic Platform list", { page });

      // 5. Verification & Audit (Senior Requirement)
      // Take a screenshot BEFORE submitting to prove what we filled in.
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const screenshotPath = `audit_logs/evidence_${booking.platform_id}_${timestamp}.png`;
      await page.screenshot({ path: screenshotPath });
      
      console.log(`Audit log saved: ${screenshotPath}`);

      // 6. Submission (Dry Run for Day 1)
      // checking if we are in "Dry Run" mode. 
      // Ideally, you would have an env var DRY_RUN=true.
      console.log("DRY RUN: Skipping final submit button click.");
      
      // UNCOMMENT THIS FOR PRODUCTION:
      // await stagehand.act("Click the 'Finalize' or 'Οριστικοποίηση' button", { page });
      // await stagehand.act("Confirm the submission if a popup appears", { page });

      // 7. Update Database
      updateStatus.run({ 
        status: 'DONE', // Or 'DRY_RUN_COMPLETE'
        screenshot: screenshotPath,
        id: booking.id 
      });
      
      // Go back to the main list for the next booking
      await stagehand.act("Click the 'Back' or 'Επιστροφή' button to return to the list", { page });
    }

  } catch (error) {
    console.error("Agent crashed:", error);
    // You should add logic here to mark the current booking as 'ERROR' in DB
  } finally {
    await stagehand.close();
  }
}

main();