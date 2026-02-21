import { insertBooking } from './db.js';

const mockData = [
  {
    guestName: "John Doe",
    checkIn: "2024-05-01",
    checkOut: "2024-05-05",
    totalPayout: 450.00,
    platformId: "HM-12345678",
    isCancelled: 0,
    cancellationDate: null
  },
  {
    guestName: "Maria Papadopoulos",
    checkIn: "2024-05-10",
    checkOut: "2024-05-15",
    totalPayout: 600.50,
    platformId: "HM-87654321",
    isCancelled: 0,
    cancellationDate: null
  },
  {
    guestName: "Anna Schmidt",
    checkIn: "2024-05-20",
    checkOut: "2024-05-25",
    totalPayout: 150.00,
    platformId: "HM-99887766",
    isCancelled: 1,
    cancellationDate: "2024-05-18"
  }
];

console.log("Ingesting mock data...");
mockData.forEach(booking => {
  insertBooking.run(booking);
  const cancelTag = booking.isCancelled ? ' (CANCELLED)' : '';
  console.log(`Queued booking: ${booking.platformId}${cancelTag}`);
});