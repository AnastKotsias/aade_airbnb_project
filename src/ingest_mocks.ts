import { insertBooking } from './db.js';

// This simulates the data we WILL eventually pull from Airbnb
const mockData = [
  {
    guestName: "John Doe",
    checkIn: "2024-05-01",
    checkOut: "2024-05-05",
    totalPayout: 450.00,
    platformId: "HM-12345678" // Airbnb Reservation Code
  },
  {
    guestName: "Maria Papadopoulos",
    checkIn: "2024-05-10",
    checkOut: "2024-05-15",
    totalPayout: 600.50,
    platformId: "HM-87654321"
  }
];

console.log("Ingesting mock data...");
mockData.forEach(booking => {
  insertBooking.run(booking);
  console.log(`Queued booking: ${booking.platformId}`);
});