import Database from 'better-sqlite3';
import type { Database as DatabaseType, Statement } from 'better-sqlite3';

const db: DatabaseType = new Database('bookings.db');

// Create bookings table
db.exec(`
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guest_name TEXT NOT NULL,
    check_in TEXT NOT NULL,
    check_out TEXT NOT NULL,
    total_payout REAL NOT NULL,
    platform_id TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'PENDING',
    audit_screenshot_path TEXT,
    is_cancelled INTEGER DEFAULT 0,
    cancellation_date TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Backward compatibility: add columns if they don't exist
// (Safe to fail if columns already exist)
try {
  db.exec(`ALTER TABLE bookings ADD COLUMN is_cancelled INTEGER DEFAULT 0`);
} catch {}

try {
  db.exec(`ALTER TABLE bookings ADD COLUMN cancellation_date TEXT`);
} catch {}

// Prepared statements for database operations
export const insertBooking: Statement = db.prepare(`
  INSERT OR IGNORE INTO bookings 
  (guest_name, check_in, check_out, total_payout, platform_id, is_cancelled, cancellation_date)
  VALUES (@guestName, @checkIn, @checkOut, @totalPayout, @platformId, @isCancelled, @cancellationDate)
`);

export const getPendingBookings: Statement = db.prepare(`
  SELECT * FROM bookings WHERE status = 'PENDING'
`);

export const getRetryBookings: Statement = db.prepare(`
  SELECT * FROM bookings WHERE status = 'RETRY_LATER'
`);

export const updateStatus: Statement = db.prepare(`
  UPDATE bookings 
  SET status = @status, audit_screenshot_path = @screenshot 
  WHERE id = @id
`);

export const updateCancellation: Statement = db.prepare(`
  UPDATE bookings 
  SET is_cancelled = 1, 
      cancellation_date = @cancellationDate,
      total_payout = @refundAmount,
      status = 'PENDING'
  WHERE platform_id = @platformId
`);

console.log("Database initialized.");
export default db;