import { useState } from 'react'

// Mock reservation data - these match the schema for AADE submission
interface Reservation {
  id: string;
  confirmationCode: string;
  listingId: string;
  listingName: string;
  guestName: string;
  guestCountry: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  totalPayout: number;
  status: 'confirmed' | 'pending' | 'completed';
  guests: number;
}

// Mock data that will be extracted by the AI agent
const mockReservations: Reservation[] = [
  {
    id: '1',
    confirmationCode: 'HMXYZ12345',
    listingId: 'LST-001',
    listingName: 'Cozy Athens Studio',
    guestName: 'John Smith',
    guestCountry: 'United States',
    checkIn: '2025-01-15',
    checkOut: '2025-01-20',
    nights: 5,
    totalPayout: 450.00,
    status: 'confirmed',
    guests: 2
  },
  {
    id: '2',
    confirmationCode: 'HMXYZ67890',
    listingId: 'LST-001',
    listingName: 'Cozy Athens Studio',
    guestName: 'Maria Garcia',
    guestCountry: 'Spain',
    checkIn: '2025-01-22',
    checkOut: '2025-01-25',
    nights: 3,
    totalPayout: 270.00,
    status: 'pending',
    guests: 1
  },
  {
    id: '3',
    confirmationCode: 'HMXYZ11223',
    listingId: 'LST-002',
    listingName: 'Sunny Mykonos Villa',
    guestName: 'Klaus Mueller',
    guestCountry: 'Germany',
    checkIn: '2025-01-10',
    checkOut: '2025-01-14',
    nights: 4,
    totalPayout: 680.00,
    status: 'completed',
    guests: 4
  },
  {
    id: '4',
    confirmationCode: 'HMXYZ33445',
    listingId: 'LST-001',
    listingName: 'Cozy Athens Studio',
    guestName: 'Sophie Dupont',
    guestCountry: 'France',
    checkIn: '2025-02-01',
    checkOut: '2025-02-07',
    nights: 6,
    totalPayout: 540.00,
    status: 'confirmed',
    guests: 2
  },
  {
    id: '5',
    confirmationCode: 'HMXYZ55667',
    listingId: 'LST-002',
    listingName: 'Sunny Mykonos Villa',
    guestName: 'Yuki Tanaka',
    guestCountry: 'Japan',
    checkIn: '2025-02-10',
    checkOut: '2025-02-15',
    nights: 5,
    totalPayout: 850.00,
    status: 'pending',
    guests: 3
  }
];

function App() {
  const [filter, setFilter] = useState<'all' | 'confirmed' | 'pending' | 'completed'>('all');

  const filteredReservations = filter === 'all' 
    ? mockReservations 
    : mockReservations.filter(r => r.status === filter);

  const totalEarnings = mockReservations.reduce((sum, r) => sum + r.totalPayout, 0);
  const upcomingCount = mockReservations.filter(r => r.status === 'confirmed' || r.status === 'pending').length;

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="logo">
          <svg viewBox="0 0 32 32" width="32" height="32" xmlns="http://www.w3.org/2000/svg">
            <path d="M16 1c2.008 0 3.463.963 4.751 3.269l.533 1.025c1.954 3.83 6.114 12.54 7.1 14.836l.145.353c.667 1.591.91 2.472.96 3.396l.01.415.001.228c0 4.062-2.877 6.478-6.357 6.478-2.224 0-4.556-1.258-6.709-3.386l-.257-.26-.172-.179h-.114l-.114.01-.056.07-.27.282c-2.117 2.162-4.397 3.463-6.652 3.463-3.48 0-6.357-2.416-6.357-6.478l.002-.228c.048-1.36.315-2.484 1.115-4.164l.135-.27c.98-2.298 5.106-10.938 7.1-14.836l.533-1.025C12.537 1.963 13.992 1 16 1z"></path>
          </svg>
          <span className="logo-text">airbnb</span>
        </div>
        <div className="header-right">
          <span className="host-badge">🏠 Host Mode</span>
          <div className="avatar">GK</div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="nav">
        <ul className="nav-list">
          <li className="nav-item">Today</li>
          <li className="nav-item">Calendar</li>
          <li className="nav-item">Listings</li>
          <li className="nav-item active">Reservations</li>
          <li className="nav-item">Earnings</li>
          <li className="nav-item">Insights</li>
        </ul>
      </nav>

      {/* Main Content */}
      <main className="main">
        <h1 className="page-title">Reservations</h1>
        <p className="page-subtitle">View and manage all your upcoming and past reservations</p>

        {/* Summary Cards */}
        <div className="summary">
          <div className="summary-card">
            <div className="summary-label">Total Earnings (This Period)</div>
            <div className="summary-value">€{totalEarnings.toFixed(2)}</div>
            <div className="summary-change">↑ 12% from last month</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">Upcoming Reservations</div>
            <div className="summary-value">{upcomingCount}</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">Total Nights Booked</div>
            <div className="summary-value">{mockReservations.reduce((sum, r) => sum + r.nights, 0)}</div>
          </div>
        </div>

        {/* Filters */}
        <div className="filters">
          <button 
            className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All ({mockReservations.length})
          </button>
          <button 
            className={`filter-btn ${filter === 'confirmed' ? 'active' : ''}`}
            onClick={() => setFilter('confirmed')}
          >
            Confirmed ({mockReservations.filter(r => r.status === 'confirmed').length})
          </button>
          <button 
            className={`filter-btn ${filter === 'pending' ? 'active' : ''}`}
            onClick={() => setFilter('pending')}
          >
            Pending ({mockReservations.filter(r => r.status === 'pending').length})
          </button>
          <button 
            className={`filter-btn ${filter === 'completed' ? 'active' : ''}`}
            onClick={() => setFilter('completed')}
          >
            Completed ({mockReservations.filter(r => r.status === 'completed').length})
          </button>
        </div>

        {/* Reservations Table */}
        <div className="reservations-container">
          <table className="reservations-table" id="reservations-table">
            <thead>
              <tr>
                <th>Guest</th>
                <th>Listing</th>
                <th>Dates</th>
                <th>Confirmation Code</th>
                <th>Status</th>
                <th>Payout</th>
              </tr>
            </thead>
            <tbody>
              {filteredReservations.map((reservation) => (
                <tr key={reservation.id} data-reservation-id={reservation.id}>
                  <td>
                    <div className="guest-info">
                      <div className="guest-avatar">{getInitials(reservation.guestName)}</div>
                      <div>
                        <div className="guest-name" data-field="guest-name">{reservation.guestName}</div>
                        <div className="guest-country">{reservation.guestCountry}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="listing-info">
                      <div className="listing-image" style={{ 
                        background: reservation.listingId === 'LST-001' 
                          ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' 
                          : 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)'
                      }} />
                      <div>
                        <div className="listing-name">{reservation.listingName}</div>
                        <div className="listing-id" data-field="listing-id">{reservation.listingId}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="dates">
                      <div className="date-range">
                        <span data-field="check-in">{formatDate(reservation.checkIn)}</span>
                        {' → '}
                        <span data-field="check-out">{formatDate(reservation.checkOut)}</span>
                      </div>
                      <div className="nights">{reservation.nights} nights · {reservation.guests} guests</div>
                    </div>
                  </td>
                  <td>
                    <span className="confirmation-code" data-field="confirmation-code">
                      {reservation.confirmationCode}
                    </span>
                  </td>
                  <td>
                    <span className={`status-badge status-${reservation.status}`}>
                      {reservation.status.charAt(0).toUpperCase() + reservation.status.slice(1)}
                    </span>
                  </td>
                  <td>
                    <div className="payout" data-field="total-payout">€{reservation.totalPayout.toFixed(2)}</div>
                    <div className="payout-details">Host earnings</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}

export default App
