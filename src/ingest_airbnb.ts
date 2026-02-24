import { Stagehand } from '@browserbasehq/stagehand';
import { z } from 'zod';
import { insertBooking } from './db.js';
import { validateEnv, MODEL_CONFIG, ENV_MODE } from './config.js';

// Validate required environment variables
validateEnv(['AIRBNB_EMAIL', 'AIRBNB_PASSWORD']);

// Zod schema for Airbnb data validation
const AirbnbSchema = z.object({
  bookings: z.array(z.object({
    guestName: z.string().min(1).describe("The full name of the guest"),
    checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Check-in date in YYYY-MM-DD format"),
    checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Check-out date in YYYY-MM-DD format"),
    totalPayout: z.number().positive("Payout must be positive - cannot send NaN to tax office"),
    confirmationCode: z.string().min(1).describe("The alphanumeric reservation code (e.g., HM123456)"),
    isCancelled: z.boolean().optional().describe("Whether the reservation was cancelled"),
    cancellationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Cancellation date in YYYY-MM-DD format if cancelled")
  }))
});

async function main() {
  console.log("🚀 Starting Airbnb Ingestion Agent...\n");

  // Initialize browser automation with selected model
  const stagehand = new Stagehand({
    env: ENV_MODE,
    verbose: 2,
    model: MODEL_CONFIG,
    localBrowserLaunchOptions: {
      headless: false, // Visible browser for debugging
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

  try {
    // Login to Airbnb
    console.log("🔐 Logging into Airbnb...");
    await page.goto("https://www.airbnb.com/login");
    
    await stagehand.act(`Fill email with ${process.env.AIRBNB_EMAIL}`);
    await stagehand.act("Click continue");
    await stagehand.act(`Fill password with ${process.env.AIRBNB_PASSWORD}`);
    await stagehand.act("Click login");

    console.log("⏳ Waiting for dashboard (manual 2FA if needed)...");
    await new Promise(r => setTimeout(r, 15000));

    // Navigate to completed bookings
    console.log("📊 Fetching completed reservations...");
    await page.goto("https://www.airbnb.com/hosting/reservations/completed");

    // Extract booking data using AI
    const data = await stagehand.extract(
      "Extract all completed bookings from the list, including cancelled reservations. For cancelled bookings, set isCancelled to true and include the cancellationDate.",
      AirbnbSchema
    );

    console.log(`\n🔍 Found ${data.bookings.length} booking(s)\n`);

    // Insert bookings into database
    for (const booking of data.bookings) {
      try {
        insertBooking.run({
          guestName: booking.guestName,
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
          totalPayout: booking.totalPayout,
          platformId: booking.confirmationCode,
          isCancelled: booking.isCancelled ? 1 : 0,
          cancellationDate: booking.cancellationDate || null
        });
        console.log(`✅ Queued: ${booking.confirmationCode}${booking.isCancelled ? ' (CANCELLED)' : ''}`);
      } catch (dbErr: any) {
        if (dbErr.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          console.log(`⏭️ Skipped: ${booking.confirmationCode} (Already in DB)`);
        } else {
          console.error(`Failed to insert ${booking.confirmationCode}:`, dbErr);
        }
      }
    }

    console.log("\n✅ Ingestion complete");

  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("\n❌ Ingestion failed:", errorMsg);
  } finally {
    console.log("\n🔒 Closing browser...");
    await stagehand.close();
  }
}

main();