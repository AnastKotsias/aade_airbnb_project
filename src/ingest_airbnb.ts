import { Stagehand } from '@browserbasehq/stagehand';
import { z } from 'zod';
import { insertBooking } from './db.js';
import dotenv from 'dotenv';

dotenv.config();

const ENV_MODE = (process.env.STAGEHAND_ENV || 'LOCAL') as 'LOCAL' | 'BROWSERBASE';

const AirbnbSchema = z.object({
  bookings: z.array(z.object({
    guestName: z.string().describe("The full name of the guest"),
    checkIn: z.string().describe("Check-in date in YYYY-MM-DD format"),
    checkOut: z.string().describe("Check-out date in YYYY-MM-DD format"),
    totalPayout: z.number().describe("The total payout amount in Euros"),
    confirmationCode: z.string().describe("The alphanumeric reservation code (e.g., HM123456)"),
    isCancelled: z.boolean().optional().describe("Whether the reservation was cancelled"),
    cancellationDate: z.string().optional().describe("Cancellation date in YYYY-MM-DD format if cancelled")
  }))
});

async function main() {
  console.log("🚀 Starting Airbnb Ingestion Agent...");

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

  try {
    await page.goto("https://www.airbnb.com/login");
    
    await stagehand.act(`Fill email with ${process.env.AIRBNB_EMAIL}`);
    await stagehand.act("Click continue");
    await stagehand.act(`Fill password with ${process.env.AIRBNB_PASSWORD}`);
    await stagehand.act("Click login");

    console.log("⏳ Waiting for dashboard (Check Live View if 2FA is needed)...");
    await new Promise(r => setTimeout(r, 15000));

    await page.goto("https://www.airbnb.com/hosting/reservations/completed");

    const data = await stagehand.extract(
      "Extract all completed bookings from the list, including cancelled reservations. For cancelled bookings, set isCancelled to true and include the cancellationDate.",
      AirbnbSchema
    );

    console.log(`🔍 Found ${data.bookings.length} bookings.`);

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

  } catch (error) {
    console.error("❌ Ingestion failed:", error);
  } finally {
    await stagehand.close();
  }
}

main();