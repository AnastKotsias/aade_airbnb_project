import { Stagehand } from '@browserbasehq/stagehand';
import { z } from 'zod';
import { insertBooking } from './db.js';
import { MODEL_CONFIG, ENV_MODE } from './config.js';

// Validate API key
if (!process.env.OPENAI_API_KEY) {
  console.error('\n❌ Missing OPENAI_API_KEY in .env file');
  process.exit(1);
}

// Zod schema for extracting reservation data from mock Airbnb
const ReservationSchema = z.object({
  reservations: z.array(z.object({
    guestName: z.string().min(1).describe("The full name of the guest"),
    checkIn: z.string().describe("Check-in date - extract in YYYY-MM-DD format"),
    checkOut: z.string().describe("Check-out date - extract in YYYY-MM-DD format"),
    totalPayout: z.number().positive().describe("Total payout amount in EUR (just the number, without € symbol)"),
    confirmationCode: z.string().min(1).describe("The reservation confirmation code (e.g., HMXYZ12345)"),
    listingId: z.string().describe("The listing ID (e.g., LST-001)"),
    listingName: z.string().describe("Name of the listing property"),
    status: z.enum(['confirmed', 'pending', 'completed']).describe("Reservation status")
  }))
});

// Helper to convert date formats (e.g., "Jan 15, 2025" -> "2025-01-15")
function normalizeDate(dateStr: string): string {
  // If already in YYYY-MM-DD format, return as-is
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  
  // Parse "Jan 15, 2025" format
  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    const isoDate = date.toISOString().split('T')[0];
    return isoDate ?? dateStr;
  }
  
  // Return original if can't parse
  console.warn(`⚠️ Could not parse date: ${dateStr}`);
  return dateStr;
}

async function main() {
  console.log("🏠 Starting Mock Airbnb Extraction Agent...\n");
  console.log("📍 Target: http://localhost:3000 (Mock Airbnb Host Dashboard)\n");

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

  try {
    // Go to mock Airbnb
    console.log("🌐 Opening Mock Airbnb Host Dashboard...");
    await page.goto("http://localhost:3000");
    await page.waitForLoadState('networkidle');
    
    // Wait for table to load
    await page.waitForSelector('#reservations-table');
    console.log("✅ Page loaded successfully\n");

    // Take screenshot for audit
    const screenshotPath = `audit_logs/mock_airbnb_${Date.now()}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`📸 Screenshot saved: ${screenshotPath}\n`);

    // Extract reservation data using AI
    console.log("🤖 AI is extracting reservation data from the table...\n");
    
    const data = await stagehand.extract(
      `Extract ALL reservations from the reservations table on this page.
      For each reservation row, extract:
      - Guest name
      - Check-in and check-out dates (convert to YYYY-MM-DD format)
      - Confirmation code (like HMXYZ12345)
      - Listing ID (like LST-001) 
      - Listing name
      - Total payout amount (just the number)
      - Status (confirmed, pending, or completed)`,
      ReservationSchema
    );

    console.log(`\n🔍 AI extracted ${data.reservations.length} reservation(s):\n`);
    console.log("─".repeat(60));

    // Process and insert each reservation
    let insertedCount = 0;
    let skippedCount = 0;

    for (const res of data.reservations) {
      // Normalize dates
      const checkIn = normalizeDate(res.checkIn);
      const checkOut = normalizeDate(res.checkOut);

      console.log(`\n📋 ${res.guestName}`);
      console.log(`   📅 ${checkIn} → ${checkOut}`);
      console.log(`   🏠 ${res.listingName} (${res.listingId})`);
      console.log(`   🔑 Code: ${res.confirmationCode}`);
      console.log(`   💰 €${res.totalPayout.toFixed(2)}`);
      console.log(`   📊 Status: ${res.status}`);

      // Only insert confirmed or completed reservations
      if (res.status === 'confirmed' || res.status === 'completed') {
        try {
          insertBooking.run({
            guestName: res.guestName,
            checkIn: checkIn,
            checkOut: checkOut,
            totalPayout: res.totalPayout,
            platformId: res.confirmationCode,
            isCancelled: 0,
            cancellationDate: null
          });
          console.log(`   ✅ Added to database (PENDING for AADE submission)`);
          insertedCount++;
        } catch (dbErr: any) {
          if (dbErr.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            console.log(`   ⏭️ Already exists in database`);
            skippedCount++;
          } else {
            console.error(`   ❌ DB Error: ${dbErr.message}`);
          }
        }
      } else {
        console.log(`   ⏸️ Skipped (status: ${res.status})`);
        skippedCount++;
      }
    }

    console.log("\n" + "─".repeat(60));
    console.log(`\n📊 Summary:`);
    console.log(`   ✅ Inserted: ${insertedCount}`);
    console.log(`   ⏭️ Skipped: ${skippedCount}`);
    console.log(`\n🎉 Extraction complete! Run 'make run-agent' to submit to AADE.\n`);

  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("\n❌ Extraction failed:", errorMsg);
    throw error;
  } finally {
    console.log("🔒 Closing browser...");
    await stagehand.close();
  }
}

main().catch((err) => {
  console.error("\n💥 Fatal error:", err);
  process.exit(1);
});
