.PHONY: setup seed run-ingest run-agent clean install-browser mock-airbnb-setup mock-airbnb-dev run-full-flow

setup:
	npm install

install-browser:
	npx playwright install chromium

seed:
	npx tsx src/ingest_mocks.ts

run-ingest:
	npx tsx src/ingest_airbnb.ts

run-agent:
	npx tsx src/agent_aade.ts

# Mock Airbnb commands
mock-airbnb-setup:
	cd mock-airbnb && npm install

mock-airbnb-dev:
	cd mock-airbnb && npm run dev

# Full flow: extract from mock Airbnb and submit to AADE
run-full-flow:
	npx tsx src/ingest_mock_airbnb.ts && npx tsx src/agent_aade.ts

# Just extract from mock Airbnb (no AADE submission)
run-extract-mock:
	npx tsx src/ingest_mock_airbnb.ts

clean:
	rm -f bookings.db
	rm -rf audit_logs/

help:
	@echo "Available targets:"
	@echo "  setup            - Install dependencies"
	@echo "  seed             - Ingest mock data into the database"
	@echo "  run-ingest       - Run Airbnb ingestion (requires .env)"
	@echo "  run-agent        - Run AADE submission agent (requires .env)"
	@echo "  mock-airbnb-setup - Install mock Airbnb dependencies"
	@echo "  mock-airbnb-dev  - Run mock Airbnb dev server (port 3000)"
	@echo "  run-extract-mock - Extract from mock Airbnb into database"
	@echo "  run-full-flow    - Extract from mock Airbnb AND submit to AADE"
	@echo "  clean            - Remove database and logs"