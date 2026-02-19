.PHONY: setup seed run clean

setup:
	npm install

seed:
	npm tsx src/ingest_mocks.ts

run:
	npm tsx src/agent_aade.ts

clean:
	rm -f bookings.db
	rm -rf audit_logs/

help:
	@echo "Available targets:"
	@echo "  setup  - Install dependencies"
	@echo "  seed   - Ingest mock data into the database"
	@echo "  run    - Start the agent to process bookings"
	@echo "  clean  - Remove database and logs"