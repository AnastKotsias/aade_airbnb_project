# ============================================================================
# AADE Airbnb Automation - Makefile
# ============================================================================
# Usage: make <target>
# Run 'make help' to see all available targets
# ============================================================================

.PHONY: setup install-browser mock-airbnb-setup mock-airbnb-dev \
        run-extract-mock run-ingest run-agent run-full-flow \
        seed clean db-status help

# ============================================================================
# SETUP TARGETS
# ============================================================================

## Install Node.js dependencies
setup:
	@echo "📦 Installing dependencies..."
	npm install
	@echo "✅ Setup complete!"

## Install Chromium browser for Playwright
install-browser:
	@echo "🌐 Installing Chromium..."
	npx playwright install chromium
	@echo "✅ Browser installed!"

## Install mock Airbnb dashboard dependencies
mock-airbnb-setup:
	@echo "📦 Installing mock Airbnb dependencies..."
	cd mock-airbnb && npm install
	@echo "✅ Mock Airbnb setup complete!"

# ============================================================================
# DEVELOPMENT TARGETS
# ============================================================================

## Start mock Airbnb dashboard (localhost:3000)
mock-airbnb-dev:
	@echo "🚀 Starting mock Airbnb dashboard at http://localhost:3000"
	cd mock-airbnb && npm run dev

# ============================================================================
# EXTRACTION TARGETS
# ============================================================================

## Extract reservations from mock Airbnb dashboard
run-extract-mock:
	@echo "🏠 Extracting from Mock Airbnb..."
	npx tsx src/ingest_mock_airbnb.ts

## Extract reservations from real Airbnb (requires credentials)
run-ingest:
	@echo "🏠 Extracting from Real Airbnb..."
	npx tsx src/ingest_airbnb.ts

## Seed database with sample booking data
seed:
	@echo "🌱 Seeding database with sample data..."
	npx tsx src/ingest_mocks.ts

# ============================================================================
# AGENT TARGETS
# ============================================================================

## Run AADE submission agent only
run-agent:
	@echo "🤖 Starting AADE submission agent..."
	npx tsx src/agent_aade.ts

## Full workflow: Extract from mock Airbnb + Submit to AADE
run-full-flow:
	@echo "🔄 Running full workflow: Extract → Submit"
	@echo ""
	npx tsx src/ingest_mock_airbnb.ts && npx tsx src/agent_aade.ts

# ============================================================================
# DATABASE TARGETS
# ============================================================================

## Show pending bookings in database
db-status:
	@npx tsx -e "import Database from 'better-sqlite3'; \
	try { \
	  const db = new Database('bookings.db'); \
	  const rows = db.prepare('SELECT id, guest_name, check_in, check_out, total_payout, status, platform_id FROM bookings ORDER BY id').all(); \
	  if (rows.length === 0) { console.log('📊 Database is empty. Run make seed or make run-extract-mock first.'); } \
	  else { \
	    console.log('📊 Database Status (' + rows.length + ' bookings):\n'); \
	    console.log('ID  | Guest              | Check-in   | Check-out  | Payout  | Status    | Platform ID'); \
	    console.log('----|--------------------|-----------:|------------|--------:|-----------|------------'); \
	    rows.forEach(r => console.log(String(r.id).padEnd(4) + '| ' + String(r.guest_name).padEnd(19) + '| ' + r.check_in + ' | ' + r.check_out + ' | €' + String(r.total_payout).padStart(6) + ' | ' + String(r.status).padEnd(9) + ' | ' + r.platform_id)); \
	  } \
	  db.close(); \
	} catch(e) { console.log('📊 No database found. Run make seed or make run-extract-mock first.'); }"

## Remove database and audit logs
clean:
	@echo "🧹 Cleaning up..."
	rm -f bookings.db
	rm -rf audit_logs/
	@echo "✅ Cleaned!"

# ============================================================================
# HELP
# ============================================================================

## Show this help message
help:
	@echo ""
	@echo "╔════════════════════════════════════════════════════════════════╗"
	@echo "║           AADE Airbnb Automation - Available Commands          ║"
	@echo "╠════════════════════════════════════════════════════════════════╣"
	@echo "║                                                                ║"
	@echo "║  SETUP                                                         ║"
	@echo "║    make setup            Install Node.js dependencies          ║"
	@echo "║    make install-browser  Install Chromium for automation       ║"
	@echo "║    make mock-airbnb-setup  Install mock dashboard deps         ║"
	@echo "║                                                                ║"
	@echo "║  DEVELOPMENT                                                   ║"
	@echo "║    make mock-airbnb-dev  Start mock Airbnb (localhost:3000)    ║"
	@echo "║                                                                ║"
	@echo "║  EXTRACTION                                                    ║"
	@echo "║    make run-extract-mock Extract from mock Airbnb              ║"
	@echo "║    make run-ingest       Extract from real Airbnb              ║"
	@echo "║    make seed             Seed DB with sample data              ║"
	@echo "║                                                                ║"
	@echo "║  AGENT                                                         ║"
	@echo "║    make run-agent        Run AADE submission agent             ║"
	@echo "║    make run-full-flow    Extract + Submit (full workflow)      ║"
	@echo "║                                                                ║"
	@echo "║  DATABASE                                                      ║"
	@echo "║    make db-status        Show pending bookings                 ║"
	@echo "║    make clean            Remove database and logs              ║"
	@echo "║                                                                ║"
	@echo "╚════════════════════════════════════════════════════════════════╝"
	@echo ""