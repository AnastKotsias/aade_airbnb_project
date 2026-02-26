/**
 * AADE Submission Agent
 * 
 * Stage 3 of the Buffer Pattern Architecture:
 * Reads pending bookings from the database and submits them to AADE.
 */

import { Stagehand, type Page } from '@browserbasehq/stagehand';
import { getPendingBookings, updateStatus } from './db.js';
import { validateEnv, MODEL_CONFIG, ENV_MODE, DRY_RUN, SLOW_MO_MS } from './config.js';
import fs from 'fs';

// Import the modular AADE handlers
import {
  type Booking,
  type AgentConfig,
  type AADEPageState,
  DEFAULT_AGENT_CONFIG,
  detectPageState,
  isLoggedIn,
  hasMaintenanceMessage,
  hasSessionExpired,
  getStateDescription,
  handleUserInfoPage,
  handlePropertyRegistryPage,
  handleDeclarationsListPage,
  fillDeclarationForm,
  submitDeclaration,
  navigateToPropertyRegistry,
} from './aade/index.js';

// Validate environment
validateEnv([]);

// Agent configuration from environment
const agentConfig: AgentConfig = {
  ...DEFAULT_AGENT_CONFIG,
  dryRun: DRY_RUN,
  slowMoMs: SLOW_MO_MS,
};

// Utilities
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Wait for user to complete manual login
 */
async function waitForLogin(page: Page, maxWaitMs: number): Promise<boolean> {
  console.log("\n" + "═".repeat(60));
  console.log("👤 MANUAL LOGIN REQUIRED");
  console.log("═".repeat(60));
  console.log("Please enter your AADE credentials in the browser and click Login.");
  console.log("The agent will continue automatically once you're logged in...");
  console.log("═".repeat(60) + "\n");
  
  const pollInterval = 2000;
  let elapsed = 0;
  
  while (elapsed < maxWaitMs) {
    await sleep(pollInterval);
    elapsed += pollInterval;
    
    if (await isLoggedIn(page)) {
      console.log("✅ Login detected! Continuing...");
      return true;
    }
    
    if (elapsed % 10000 === 0) {
      process.stdout.write(".");
    }
  }
  
  return false;
}

/**
 * Take an audit screenshot and return the path
 */
async function takeAuditScreenshot(
  page: Page,
  prefix: string,
  bookingId?: string
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = bookingId 
    ? `${prefix}_${bookingId}_${timestamp}.png`
    : `${prefix}_${timestamp}.png`;
  const screenshotPath = `${agentConfig.auditLogsDir}/${filename}`;
  
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`📸 Screenshot saved: ${screenshotPath}`);
  
  return screenshotPath;
}

/**
 * Handle the current page state and transition to the next
 */
async function handleCurrentState(
  stagehand: Stagehand,
  page: Page,
  state: AADEPageState
): Promise<{ success: boolean; nextState?: AADEPageState; error?: string }> {
  console.log(`\n📍 Current state: ${getStateDescription(state)}`);
  
  switch (state) {
    case 'LOGIN': {
      const loginSuccess = await waitForLogin(page, agentConfig.maxLoginWaitMs);
      if (!loginSuccess) {
        return { success: false, error: 'Login timeout' };
      }
      await page.waitForLoadState('domcontentloaded');
      await sleep(2000);
      const newState = await detectPageState(page);
      return { success: true, nextState: newState };
    }
    
    case 'USER_INFO':
      return await handleUserInfoPage(stagehand, page, agentConfig);
    
    case 'PROPERTY_REGISTRY':
      return await handlePropertyRegistryPage(stagehand, page, agentConfig);
    
    case 'DECLARATIONS_LIST':
      return await handleDeclarationsListPage(stagehand, page, agentConfig);
    
    case 'UNKNOWN':
      await navigateToPropertyRegistry(stagehand, page);
      await sleep(2000);
      return { success: true, nextState: await detectPageState(page) };
    
    default:
      return { success: true, nextState: state };
  }
}

/**
 * Process a single booking through AADE
 */
async function processBooking(
  stagehand: Stagehand,
  page: Page,
  booking: Booking
): Promise<{ status: string; screenshot: string | null }> {
  const cancelledTag = booking.is_cancelled ? ' (CANCELLED)' : '';
  console.log(`\n${"─".repeat(60)}`);
  console.log(`📝 Processing: ${booking.platform_id} - ${booking.guest_name}${cancelledTag}`);
  console.log(`   📅 ${booking.check_in} → ${booking.check_out}`);
  console.log(`   💰 €${booking.total_payout.toFixed(2)}`);
  
  try {
    await navigateToPropertyRegistry(stagehand, page);
    
    let currentState = await detectPageState(page);
    const maxTransitions = 5;
    let transitions = 0;
    
    while (currentState !== 'NEW_DECLARATION' && transitions < maxTransitions) {
      const result = await handleCurrentState(stagehand, page, currentState);
      
      if (!result.success) {
        if (result.error === 'NO_PROPERTIES_REGISTERED') {
          return { status: 'NEEDS_PROPERTY', screenshot: null };
        }
        throw new Error(result.error || 'State transition failed');
      }
      
      currentState = result.nextState || await detectPageState(page);
      transitions++;
    }
    
    if (currentState !== 'NEW_DECLARATION') {
      throw new Error(`Could not reach declaration form (stuck at: ${currentState})`);
    }
    
    const fillResult = await fillDeclarationForm(stagehand, page, booking, agentConfig);
    
    if (!fillResult.success) {
      throw new Error(fillResult.error || 'Form filling failed');
    }
    
    const screenshotPath = await takeAuditScreenshot(page, 'declaration', booking.platform_id);
    
    const submitResult = await submitDeclaration(
      stagehand, page, booking, agentConfig, screenshotPath
    );
    
    if (!submitResult.success) {
      throw new Error(submitResult.error || 'Submission failed');
    }
    
    const status = agentConfig.dryRun ? 'DRY_RUN_VERIFIED' : 'SUBMITTED';
    console.log(`✅ Booking processed: ${status}`);
    
    return { status, screenshot: screenshotPath };
    
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`❌ Error processing booking: ${errorMsg}`);
    
    const isMaintenanceError = await hasMaintenanceMessage(page) ||
      errorMsg.toLowerCase().includes('maintenance') ||
      errorMsg.toLowerCase().includes('συντήρηση');
    
    const status = isMaintenanceError ? 'RETRY_LATER' : 'ERROR';
    
    if (isMaintenanceError) {
      console.log("⚠️  System maintenance detected - will retry later");
    }
    
    return { status, screenshot: null };
  }
}

/**
 * Main agent entry point
 */
async function main() {
  if (!fs.existsSync(agentConfig.auditLogsDir)) {
    fs.mkdirSync(agentConfig.auditLogsDir, { recursive: true });
  }
  
  const stagehand = new Stagehand({
    env: ENV_MODE,
    verbose: 2,
    model: MODEL_CONFIG,
    localBrowserLaunchOptions: {
      headless: false,
      args: ['--disable-save-password-bubble', '--disable-translate'],
    },
    browserbaseSessionCreateParams: {
      browserSettings: { blockAds: true },
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
  
  const bookings = getPendingBookings.all() as Booking[];
  
  if (bookings.length === 0) {
    console.log("✅ No pending bookings to submit.");
    await stagehand.close();
    return;
  }
  
  console.log(`📋 Found ${bookings.length} pending booking(s) to process`);
  console.log(`🔧 Mode: ${agentConfig.dryRun ? 'DRY RUN (no actual submission)' : 'PRODUCTION'}`);
  
  try {
    console.log("\n🌐 Navigating to AADE portal...");
    await page.goto("https://www1.gsis.gr/taxisnet/short_term_letting/");
    await sleep(2000);
    
    let currentState = await detectPageState(page);
    console.log(`📍 Initial state: ${getStateDescription(currentState)}`);
    
    if (currentState === 'LOGIN') {
      const loginResult = await handleCurrentState(stagehand, page, currentState);
      if (!loginResult.success) {
        throw new Error(loginResult.error || 'Login failed');
      }
      currentState = loginResult.nextState || await detectPageState(page);
    }
    
    if (currentState === 'USER_INFO') {
      const userInfoResult = await handleCurrentState(stagehand, page, currentState);
      if (!userInfoResult.success) {
        console.warn("⚠️  Could not complete user info, continuing anyway...");
      }
      await page.waitForLoadState('domcontentloaded');
      await sleep(2000);
    }
    
    if (await hasSessionExpired(page)) {
      throw new Error("Session expired or login failed");
    }
    
    console.log("✅ Successfully logged in to AADE portal");
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const booking of bookings) {
      const result = await processBooking(stagehand, page, booking);
      
      updateStatus.run({
        status: result.status,
        screenshot: result.screenshot,
        id: booking.id,
      });
      
      if (result.status === 'SUBMITTED' || result.status === 'DRY_RUN_VERIFIED') {
        successCount++;
      } else {
        errorCount++;
        
        if (result.status === 'NEEDS_PROPERTY') {
          console.log("\n" + "═".repeat(60));
          console.log("⚠️  NO PROPERTIES REGISTERED IN AADE");
          console.log("═".repeat(60));
          console.log("You need to register a property first before making declarations.");
          console.log("After registering in AADE, run this agent again.");
          console.log("═".repeat(60) + "\n");
          
          for (const remaining of bookings.slice(bookings.indexOf(booking) + 1)) {
            updateStatus.run({
              status: 'NEEDS_PROPERTY',
              screenshot: null,
              id: remaining.id,
            });
          }
          break;
        }
      }
    }
    
    console.log(`\n${"═".repeat(60)}`);
    console.log("📊 PROCESSING SUMMARY");
    console.log("═".repeat(60));
    console.log(`   ✅ Successful: ${successCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log(`   📁 Audit logs: ${agentConfig.auditLogsDir}/`);
    console.log("═".repeat(60) + "\n");
    
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("\n❌ Critical error:", errorMsg);
  } finally {
    console.log("🔒 Closing browser...");
    await stagehand.close();
  }
}

main();
