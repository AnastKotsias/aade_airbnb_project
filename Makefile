.PHONY: setup seed run-ingest run-agent clean

setup:
	npm install

seed:
	npx tsx src/ingest_mocks.ts

run-ingest:
	npx tsx src/ingest_airbnb.ts

run-agent:
	npx tsx src/agent_aade.ts

clean:
	rm -f bookings.db
	rm -rf audit_logs/

help:
	@echo "Available targets:"
	@echo "  setup      - Install dependencies"
	@echo "  seed       - Ingest mock data into the database"
	@echo "  run-ingest - Run Airbnb ingestion (requires .env)"
	@echo "  run-agent  - Run AADE submission agent (requires .env)"
	@echo "  clean      - Remove database and logs"