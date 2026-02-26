# 🏠 AADE Airbnb Automation Agent

Automated declaration submission for Greek short-term rental tax compliance (AADE/TaxisNet).

This project uses **Stagehand** (powered by Browserbase) to automate the process of extracting reservation data from Airbnb and submitting declarations to the Greek tax authority (AADE).

---

## 📋 Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Setup](#setup)
- [Usage](#usage)
- [Configuration](#configuration)
- [How It Works](#how-it-works)
- [Extending the Code](#extending-the-code)
- [Troubleshooting](#troubleshooting)

---

## Overview

In Greece, property owners who rent via platforms like Airbnb must declare each stay to AADE (the tax authority). This project automates that workflow:

1. **Extract** reservation data from Airbnb (or a mock Airbnb dashboard)
2. **Store** bookings in a local SQLite database (the "buffer")
3. **Submit** declarations to AADE via browser automation

### Key Features

- ✅ **AI-Powered Extraction** - Uses LLMs to understand webpages semantically (no brittle CSS selectors)
- ✅ **Buffer Pattern** - Decouples data extraction from submission for reliability
- ✅ **Dry Run Mode** - Test the full flow without actually submitting to AADE
- ✅ **Audit Logs** - Screenshots saved for every action for compliance
- ✅ **Manual Login Support** - Handles 2FA by pausing for manual credential entry
- ✅ **Extendable Architecture** - Configuration-driven form fields and page handlers

---

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Stage 1       │     │   Stage 2       │     │   Stage 3       │
│   INGESTOR      │────▶│   DATABASE      │────▶│   SUBMITTER     │
│                 │     │   (Buffer)      │     │                 │
│ • Mock Airbnb   │     │ • SQLite        │     │ • AADE Portal   │
│ • Real Airbnb   │     │ • bookings.db   │     │ • Stagehand AI  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

This **Buffer Pattern** ensures:
- If AADE is down, your extracted data isn't lost
- You can review bookings before submission
- Failed submissions can be retried later

---

## Project Structure

```
aade_airbnb_project/
├── src/
│   ├── config.ts              # Environment & LLM configuration
│   ├── db.ts                  # SQLite database schema & queries
│   ├── ingest_mock_airbnb.ts  # Extract from mock Airbnb dashboard
│   ├── ingest_airbnb.ts       # Extract from real Airbnb (requires login)
│   ├── ingest_mocks.ts        # Seed database with sample data
│   ├── agent_aade.ts          # Main AADE submission agent
│   └── aade/                  # AADE portal automation module
│       ├── types.ts           # TypeScript interfaces
│       ├── config.ts          # Form fields, labels, buttons (Greek/English)
│       ├── pageDetector.ts    # Detect current AADE portal page
│       ├── handlers.ts        # Page-specific action handlers
│       └── index.ts           # Module exports
├── mock-airbnb/               # Mock Airbnb dashboard (React/Vite)
│   ├── src/App.tsx            # Dashboard UI with sample reservations
│   └── ...
├── audit_logs/                # Screenshots saved here (auto-created)
├── bookings.db                # SQLite database (auto-created)
├── .env                       # Your credentials (create from .env.example)
├── .env.example               # Template for environment variables
├── Makefile                   # Convenient commands
├── package.json               # Node.js dependencies
└── tsconfig.json              # TypeScript configuration
```

### Core Files Explained

| File | Purpose |
|------|---------|
| `src/config.ts` | Loads `.env`, configures Stagehand (local/Browserbase), LLM model |
| `src/db.ts` | SQLite schema for bookings, prepared statements for CRUD |
| `src/ingest_mock_airbnb.ts` | Opens mock dashboard, uses AI to extract reservations |
| `src/agent_aade.ts` | Main agent: navigates AADE, fills forms, submits declarations |
| `src/aade/config.ts` | **All AADE form labels in Greek/English** - update here if UI changes |
| `src/aade/handlers.ts` | Modular handlers for each AADE page (login, registry, form) |
| `src/aade/pageDetector.ts` | Detects which AADE page you're on based on URL/content |

---

## Setup

### Prerequisites

- **Node.js** v18+ 
- **OpenAI API Key** (for Stagehand's AI capabilities)

### Installation

```bash
# 1. Clone the repository
git clone <repo-url>
cd aade_airbnb_project

# 2. Install dependencies
make setup

# 3. Install browser (Chromium for Playwright)
make install-browser

# 4. Set up mock Airbnb dashboard
make mock-airbnb-setup

# 5. Create your .env file
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY
```

### Environment Variables

Edit `.env` with your credentials:

```env
# REQUIRED
OPENAI_API_KEY=sk-your-openai-api-key-here

# Optional: Run locally (default) or via Browserbase cloud
STAGEHAND_ENV=LOCAL

# Safety: Keep true until you're ready to submit for real
DRY_RUN=true

# Optional: For real Airbnb extraction
AIRBNB_EMAIL=your_email@example.com
AIRBNB_PASSWORD=your_password
```

---

## Usage

### Quick Start (Mock Airbnb → AADE)

```bash
# Terminal 1: Start the mock Airbnb dashboard
make mock-airbnb-dev

# Terminal 2: Run the full flow
make run-full-flow
```

This will:
1. Open the mock Airbnb dashboard at `http://localhost:3000`
2. Extract all reservations using AI
3. Save them to `bookings.db`
4. Open AADE portal and wait for you to login
5. Process each booking (dry run by default)

### Available Commands

| Command | Description |
|---------|-------------|
| `make setup` | Install Node.js dependencies |
| `make install-browser` | Install Chromium for Playwright |
| `make mock-airbnb-setup` | Install mock dashboard dependencies |
| `make mock-airbnb-dev` | Start mock Airbnb at localhost:3000 |
| `make run-extract-mock` | Extract from mock Airbnb only |
| `make run-agent` | Run AADE submission agent only |
| `make run-full-flow` | Extract + Submit (complete workflow) |
| `make seed` | Seed database with sample bookings |
| `make clean` | Delete database and audit logs |
| `make help` | Show all available commands |

### Running Individual Steps

```bash
# Step 1: Extract reservations (choose one)
make run-extract-mock    # From mock Airbnb
make run-ingest          # From real Airbnb (requires credentials)
make seed                # Or just seed with sample data

# Step 2: Submit to AADE
make run-agent
```

---

## Configuration

### Dry Run Mode

By default, `DRY_RUN=true` prevents actual submission to AADE. The agent will:
- Navigate through all forms
- Fill in all fields
- Take screenshots
- Click "Back" instead of "Submit"

To enable real submissions:
```env
DRY_RUN=false
```

### AADE Form Configuration

All form field labels are defined in `src/aade/config.ts`:

```typescript
// Example: If AADE changes a label, update here
export const DECLARATION_FORM_CONFIG = {
  fields: {
    arrivalDate: {
      labelGreek: 'Ημερομηνία Άφιξης',
      labelEnglish: 'Arrival Date',
      // ...
    },
    // ...
  }
};
```

---

## How It Works

### 1. Data Extraction (Stagehand)

Stagehand uses AI to understand webpages semantically:

```typescript
// Instead of fragile selectors like: document.querySelector('#booking-table tr')
// We use natural language:
const data = await stagehand.extract(
  "Extract all reservations from the table including guest name, dates, and payout",
  ReservationSchema  // Zod schema for validation
);
```

### 2. Database Buffer (SQLite)

Bookings are stored with a status field:
- `PENDING` - Ready for submission
- `SUBMITTED` - Successfully declared
- `DRY_RUN_VERIFIED` - Verified but not submitted
- `ERROR` - Failed permanently
- `RETRY_LATER` - Temporary failure (maintenance, etc.)
- `NEEDS_PROPERTY` - Property not registered in AADE

### 3. AADE Submission (State Machine)

The agent uses a state machine pattern:

```
LOGIN → USER_INFO → PROPERTY_REGISTRY → DECLARATIONS_LIST → NEW_DECLARATION → SUBMITTED
```

Each state has a dedicated handler in `src/aade/handlers.ts`.

### 4. Manual Login Support

AADE uses TaxisNet with 2FA. The agent:
1. Opens the login page
2. Displays a prompt to enter credentials manually
3. Polls until login is detected
4. Continues automatically

---

## Extending the Code

### Adding a New Platform (e.g., Booking.com)

1. Create `src/ingest_booking.ts` following `ingest_mock_airbnb.ts` pattern
2. Use `stagehand.extract()` with a schema for Booking.com's format
3. Insert into the same `bookings.db` table

### Adding New AADE Form Fields

1. Add field config in `src/aade/config.ts`:
```typescript
newField: {
  name: 'New Field',
  labelGreek: 'Νέο Πεδίο',
  labelEnglish: 'New Field',
  type: 'text',
  required: true,
}
```

2. Use it in `src/aade/handlers.ts`:
```typescript
await stagehand.act(buildFieldInstruction('fill', fields.newField, value));
```

### Adding a New AADE Page Handler

1. Add page state to `src/aade/types.ts`
2. Add URL pattern to `src/aade/config.ts`
3. Add detection logic to `src/aade/pageDetector.ts`
4. Add handler to `src/aade/handlers.ts`

---

## Troubleshooting

### "No properties registered in AADE"

You need to manually register your property in AADE first:
1. Log into https://www1.gsis.gr/taxisnet/short_term_letting/
2. Click "Εισαγωγή Ακινήτου" (Add Property)
3. Fill in your property details
4. Run the agent again

### "Login timeout"

The agent waits 5 minutes for manual login. If you need more time, adjust `maxLoginWaitMs` in `src/aade/config.ts`.

### "Session expired"

AADE sessions expire quickly. Run the agent again and login promptly.

### OpenAI API Errors

Ensure your `OPENAI_API_KEY` is valid and has credits. The agent uses `gpt-4o-mini` by default.

---

## License

ISC

---

## Acknowledgments

- [Stagehand](https://github.com/browserbase/stagehand) - AI-powered browser automation
- [Browserbase](https://browserbase.com) - Cloud browser infrastructure
- [Playwright](https://playwright.dev) - Browser automation framework
