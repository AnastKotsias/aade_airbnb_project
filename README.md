# AADE Airbnb Automation

Automated AADE tax declaration submission for Airbnb short-term rental income.

## Quick Setup

```bash
# 1. Install dependencies
make setup

# 2. Install Chromium browser (for LOCAL mode)
make install-browser

# 3. Copy and configure environment
cp .env.example .env
# Edit .env and add your AADE credentials

# 4. Test with mock data
make clean          # Start fresh
make seed           # Add 3 test bookings
make run-agent      # Opens browser, processes bookings (safe, DRY_RUN=true)
```

## Environment Variables

Edit `.env` file:

- `STAGEHAND_ENV` - Set to `LOCAL` (see browser) or `BROWSERBASE` (cloud)
- `DRY_RUN` - Set to `true` (safe testing) or `false` (actual submission)
- `AADE_USERNAME` / `AADE_PASSWORD` - Your Taxisnet credentials

## Commands

| Command | Description |
|---------|-------------|
| `make setup` | Install npm dependencies |
| `make install-browser` | Install Chromium for LOCAL mode |
| `make seed` | Create mock bookings in database |
| `make run-agent` | Process pending bookings → AADE |
| `make run-ingest` | Scrape bookings from Airbnb |
| `make clean` | Delete database and logs |

## Workflow

1. **Ingest** - Get bookings from Airbnb → local DB
2. **Process** - Submit pending bookings → AADE
3. **Audit** - Screenshots saved to `audit_logs/`

## Cancellations

The system handles cancelled bookings per AADE requirements:
- If `is_cancelled=1`, uses "cancellation policy" fields
- Include cancellation fee amount and date
