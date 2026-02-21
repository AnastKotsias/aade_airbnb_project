import Database from 'better-sqlite3';
import type { Database as DatabaseType, Statement } from 'better-sqlite3';

const db: DatabaseType = new Database('bookings.db');

// Initialize the table
db.exec(`
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guest_name TEXT,
    check_in TEXT,
    check_out TEXT,
    total_payout REAL,
    platform_id TEXT UNIQUE,
    status TEXT DEFAULT 'PENDING',
    audit_screenshot_path TEXT,
    is_cancelled INTEGER DEFAULT 0,
    cancellation_date TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

try {
  db.exec(`ALTER TABLE bookings ADD COLUMN is_cancelled INTEGER DEFAULT 0`);
} catch {}

try {
  db.exec(`ALTER TABLE bookings ADD COLUMN cancellation_date TEXT`);
} catch {}

export const insertBooking: Statement = db.prepare(`
  INSERT OR IGNORE INTO bookings 
  (guest_name, check_in, check_out, total_payout, platform_id, is_cancelled, cancellation_date)
  VALUES (@guestName, @checkIn, @checkOut, @totalPayout, @platformId, @isCancelled, @cancellationDate)
`);

export const getPendingBookings: Statement = db.prepare(`
  SELECT * FROM bookings WHERE status = 'PENDING'
`);

export const updateStatus: Statement = db.prepare(`
  UPDATE bookings SET status = @status, audit_screenshot_path = @screenshot WHERE id = @id
`);

console.log("Database initialized.");
export default db;