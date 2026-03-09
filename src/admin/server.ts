/**
 * Admin Dashboard API Server
 * 
 * Provides REST endpoints for:
 * - Viewing all bookings and their statuses
 * - Viewing audit logs and screenshots
 * - Triggering the extraction and submission agents
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db, { getPendingBookings, getRetryBookings } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3001;
const AUDIT_LOGS_DIR = path.resolve('./audit_logs');
const ADMIN_UI_DIR = path.resolve('./admin-ui/dist');

// CORS headers for development
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Helper to send JSON response
function sendJSON(res: http.ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { ...corsHeaders, 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// Helper to send error response
function sendError(res: http.ServerResponse, message: string, status = 500) {
  sendJSON(res, { error: message }, status);
}

// Get all bookings with optional filters
function getAllBookings(status?: string) {
  let query = 'SELECT * FROM bookings ORDER BY created_at DESC';
  if (status && status !== 'ALL') {
    query = `SELECT * FROM bookings WHERE status = '${status}' ORDER BY created_at DESC`;
  }
  return db.prepare(query).all();
}

// Get booking statistics
function getBookingStats() {
  const stats = db.prepare(`
    SELECT 
      status,
      COUNT(*) as count,
      SUM(total_payout) as total_payout
    FROM bookings
    GROUP BY status
  `).all() as Array<{ status: string; count: number; total_payout: number }>;
  
  const totalBookings = db.prepare('SELECT COUNT(*) as count FROM bookings').get() as { count: number };
  const totalRevenue = db.prepare('SELECT SUM(total_payout) as total FROM bookings').get() as { total: number };
  const cancelledCount = db.prepare('SELECT COUNT(*) as count FROM bookings WHERE is_cancelled = 1').get() as { count: number };
  
  return {
    byStatus: stats.reduce((acc, s) => ({ ...acc, [s.status]: { count: s.count, revenue: s.total_payout || 0 } }), {}),
    total: totalBookings.count,
    totalRevenue: totalRevenue.total || 0,
    cancelled: cancelledCount.count,
  };
}

// Get audit logs (screenshots)
function getAuditLogs() {
  if (!fs.existsSync(AUDIT_LOGS_DIR)) {
    return [];
  }
  
  const files = fs.readdirSync(AUDIT_LOGS_DIR)
    .filter(f => f.endsWith('.png'))
    .map(filename => {
      const filepath = path.join(AUDIT_LOGS_DIR, filename);
      const stats = fs.statSync(filepath);
      
      // Parse filename to extract booking info
      const parts = filename.replace('.png', '').split('_');
      const type = parts[0]; // 'declaration', 'mock_airbnb', etc.
      const bookingId = parts.length > 2 ? parts[1] : null;
      
      return {
        filename,
        type,
        bookingId,
        createdAt: stats.mtime.toISOString(),
        size: stats.size,
        url: `/audit/${filename}`,
      };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  
  return files;
}

// Update booking status manually
function updateBookingStatus(id: number, status: string) {
  const stmt = db.prepare('UPDATE bookings SET status = ? WHERE id = ?');
  return stmt.run(status, id);
}

// Delete a booking
function deleteBooking(id: number) {
  const stmt = db.prepare('DELETE FROM bookings WHERE id = ?');
  return stmt.run(id);
}

// Reset all bookings to PENDING (for demo purposes)
function resetAllBookings() {
  const stmt = db.prepare("UPDATE bookings SET status = 'PENDING', audit_screenshot_path = NULL");
  return stmt.run();
}

// Serve static files (for the admin UI)
function serveStaticFile(res: http.ServerResponse, filepath: string) {
  const ext = path.extname(filepath).toLowerCase();
  const contentTypes: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
  };
  
  const contentType = contentTypes[ext] || 'application/octet-stream';
  
  fs.readFile(filepath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { ...corsHeaders, 'Content-Type': contentType });
    res.end(data);
  });
}

// Parse JSON body from request
function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// Main request handler
async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const pathname = url.pathname;
  const method = req.method || 'GET';
  
  // Handle CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }
  
  console.log(`${method} ${pathname}`);
  
  try {
    // API Routes
    if (pathname.startsWith('/api/')) {
      const route = pathname.replace('/api/', '');
      
      // GET /api/bookings - Get all bookings
      if (route === 'bookings' && method === 'GET') {
        const status = url.searchParams.get('status') || undefined;
        const bookings = getAllBookings(status);
        return sendJSON(res, bookings);
      }
      
      // GET /api/stats - Get booking statistics
      if (route === 'stats' && method === 'GET') {
        const stats = getBookingStats();
        return sendJSON(res, stats);
      }
      
      // GET /api/audit-logs - Get audit log files
      if (route === 'audit-logs' && method === 'GET') {
        const logs = getAuditLogs();
        return sendJSON(res, logs);
      }
      
      // PUT /api/bookings/:id/status - Update booking status
      const statusMatch = route.match(/^bookings\/(\d+)\/status$/);
      if (statusMatch && method === 'PUT') {
        const id = parseInt(statusMatch[1]!, 10);
        const body = await parseBody(req);
        const status = body.status as string;
        if (!status) {
          return sendError(res, 'Status is required', 400);
        }
        updateBookingStatus(id, status);
        return sendJSON(res, { success: true });
      }
      
      // DELETE /api/bookings/:id - Delete a booking
      const deleteMatch = route.match(/^bookings\/(\d+)$/);
      if (deleteMatch && method === 'DELETE') {
        const id = parseInt(deleteMatch[1]!, 10);
        deleteBooking(id);
        return sendJSON(res, { success: true });
      }
      
      // POST /api/reset - Reset all bookings to PENDING
      if (route === 'reset' && method === 'POST') {
        resetAllBookings();
        return sendJSON(res, { success: true, message: 'All bookings reset to PENDING' });
      }
      
      // GET /api/config - Get current configuration
      if (route === 'config' && method === 'GET') {
        return sendJSON(res, {
          dryRun: process.env.DRY_RUN !== 'false',
          environment: process.env.STAGEHAND_ENV || 'LOCAL',
          mockAirbnbUrl: 'http://localhost:3000',
          aadeUrl: 'https://www1.gsis.gr/taxisnet/short_term_letting/',
        });
      }
      
      return sendError(res, 'API route not found', 404);
    }
    
    // Serve audit log screenshots
    if (pathname.startsWith('/audit/')) {
      const filename = pathname.replace('/audit/', '');
      const filepath = path.join(AUDIT_LOGS_DIR, filename);
      if (fs.existsSync(filepath)) {
        return serveStaticFile(res, filepath);
      }
      return sendError(res, 'Audit file not found', 404);
    }
    
    // Serve admin UI static files
    if (pathname === '/' || pathname === '/index.html') {
      const indexPath = path.join(ADMIN_UI_DIR, 'index.html');
      if (fs.existsSync(indexPath)) {
        return serveStaticFile(res, indexPath);
      }
      // Fallback: serve inline HTML if build doesn't exist
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(getInlineAdminUI());
    }
    
    // Try to serve static file from admin UI
    const staticPath = path.join(ADMIN_UI_DIR, pathname);
    if (fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
      return serveStaticFile(res, staticPath);
    }
    
    // Fallback for SPA routing
    const indexPath = path.join(ADMIN_UI_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      return serveStaticFile(res, indexPath);
    }
    
    // Serve inline admin UI
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(getInlineAdminUI());
    
  } catch (error) {
    console.error('Request error:', error);
    sendError(res, error instanceof Error ? error.message : 'Internal server error');
  }
}

// Inline admin UI HTML (used when build doesn't exist)
function getInlineAdminUI(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AADE Automation - Admin Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            primary: '#1e3a8a',
            secondary: '#3b82f6',
            success: '#22c55e',
            warning: '#f59e0b',
            error: '#ef4444',
          }
        }
      }
    }
  </script>
  <style>
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .5; } }
    .animate-pulse { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
    .status-badge { padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 600; text-transform: uppercase; }
    .status-PENDING { background: #fef3c7; color: #92400e; }
    .status-SUBMITTED { background: #d1fae5; color: #065f46; }
    .status-ERROR { background: #fee2e2; color: #991b1b; }
    .status-RETRY_LATER { background: #e0e7ff; color: #3730a3; }
    .status-DRY_RUN_VERIFIED { background: #dbeafe; color: #1e40af; }
    .status-NEEDS_PROPERTY { background: #fce7f3; color: #9d174d; }
  </style>
</head>
<body class="bg-gray-50 min-h-screen">
  <div id="app" class="flex flex-col min-h-screen">
    <!-- Header -->
    <header class="bg-primary text-white shadow-lg">
      <div class="max-w-7xl mx-auto px-4 py-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-4">
            <div class="text-2xl font-bold">🏛️ AADE Automation</div>
            <span class="text-blue-200 text-sm">Admin Dashboard</span>
          </div>
          <div class="flex items-center space-x-4">
            <span id="env-badge" class="px-3 py-1 bg-blue-800 rounded-full text-xs"></span>
            <span id="dry-run-badge" class="px-3 py-1 bg-yellow-600 rounded-full text-xs hidden">DRY RUN MODE</span>
          </div>
        </div>
      </div>
    </header>

    <!-- Navigation Tabs -->
    <nav class="bg-white border-b">
      <div class="max-w-7xl mx-auto px-4">
        <div class="flex space-x-8">
          <button onclick="showTab('dashboard')" class="tab-btn active py-4 px-1 border-b-2 border-primary text-primary font-medium" data-tab="dashboard">
            📊 Dashboard
          </button>
          <button onclick="showTab('bookings')" class="tab-btn py-4 px-1 border-b-2 border-transparent text-gray-500 hover:text-gray-700" data-tab="bookings">
            📋 Bookings
          </button>
          <button onclick="showTab('audit')" class="tab-btn py-4 px-1 border-b-2 border-transparent text-gray-500 hover:text-gray-700" data-tab="audit">
            📸 Audit Logs
          </button>
          <button onclick="showTab('actions')" class="tab-btn py-4 px-1 border-b-2 border-transparent text-gray-500 hover:text-gray-700" data-tab="actions">
            ⚡ Actions
          </button>
        </div>
      </div>
    </nav>

    <!-- Main Content -->
    <main class="flex-1 max-w-7xl mx-auto px-4 py-6 w-full">
      
      <!-- Dashboard Tab -->
      <div id="tab-dashboard" class="tab-content">
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div class="bg-white rounded-xl shadow p-6">
            <div class="text-gray-500 text-sm mb-1">Total Bookings</div>
            <div id="stat-total" class="text-3xl font-bold text-gray-900">-</div>
          </div>
          <div class="bg-white rounded-xl shadow p-6">
            <div class="text-gray-500 text-sm mb-1">Total Revenue</div>
            <div id="stat-revenue" class="text-3xl font-bold text-green-600">-</div>
          </div>
          <div class="bg-white rounded-xl shadow p-6">
            <div class="text-gray-500 text-sm mb-1">Pending Submissions</div>
            <div id="stat-pending" class="text-3xl font-bold text-yellow-600">-</div>
          </div>
          <div class="bg-white rounded-xl shadow p-6">
            <div class="text-gray-500 text-sm mb-1">Successfully Submitted</div>
            <div id="stat-submitted" class="text-3xl font-bold text-blue-600">-</div>
          </div>
        </div>

        <!-- Status Breakdown -->
        <div class="bg-white rounded-xl shadow p-6 mb-8">
          <h3 class="text-lg font-semibold mb-4">Status Breakdown</h3>
          <div id="status-breakdown" class="flex flex-wrap gap-4"></div>
        </div>

        <!-- Recent Activity -->
        <div class="bg-white rounded-xl shadow p-6">
          <h3 class="text-lg font-semibold mb-4">Recent Bookings</h3>
          <div id="recent-bookings" class="overflow-x-auto"></div>
        </div>
      </div>

      <!-- Bookings Tab -->
      <div id="tab-bookings" class="tab-content hidden">
        <div class="bg-white rounded-xl shadow">
          <div class="p-4 border-b flex items-center justify-between">
            <h2 class="text-lg font-semibold">All Bookings</h2>
            <div class="flex items-center space-x-2">
              <select id="status-filter" onchange="loadBookings()" class="border rounded-lg px-3 py-2 text-sm">
                <option value="ALL">All Statuses</option>
                <option value="PENDING">Pending</option>
                <option value="SUBMITTED">Submitted</option>
                <option value="ERROR">Error</option>
                <option value="RETRY_LATER">Retry Later</option>
                <option value="DRY_RUN_VERIFIED">Dry Run Verified</option>
              </select>
              <button onclick="loadBookings()" class="bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-lg text-sm">
                🔄 Refresh
              </button>
            </div>
          </div>
          <div id="bookings-table" class="overflow-x-auto"></div>
        </div>
      </div>

      <!-- Audit Logs Tab -->
      <div id="tab-audit" class="tab-content hidden">
        <div class="bg-white rounded-xl shadow p-6">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-lg font-semibold">Audit Screenshots</h2>
            <button onclick="loadAuditLogs()" class="bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-lg text-sm">
              🔄 Refresh
            </button>
          </div>
          <div id="audit-logs" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"></div>
        </div>
      </div>

      <!-- Actions Tab -->
      <div id="tab-actions" class="tab-content hidden">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <!-- Extraction Actions -->
          <div class="bg-white rounded-xl shadow p-6">
            <h3 class="text-lg font-semibold mb-4">📥 Data Extraction</h3>
            <p class="text-gray-600 text-sm mb-4">
              Extract reservation data from the Mock Airbnb dashboard and save to the local database.
            </p>
            <div class="space-y-4">
              <div class="p-4 bg-blue-50 rounded-lg">
                <div class="font-medium text-blue-900 mb-2">Mock Airbnb Extraction</div>
                <p class="text-sm text-blue-700 mb-3">Runs the AI agent to extract reservations from localhost:3000</p>
                <div class="text-xs text-blue-600 mb-3">
                  <strong>Command:</strong> <code class="bg-blue-100 px-2 py-1 rounded">npm run ingest:mock</code>
                </div>
                <button onclick="alert('Run in terminal: npm run ingest:mock')" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm w-full">
                  🤖 Start Extraction
                </button>
              </div>
            </div>
          </div>

          <!-- AADE Submission Actions -->
          <div class="bg-white rounded-xl shadow p-6">
            <h3 class="text-lg font-semibold mb-4">📤 AADE Submission</h3>
            <p class="text-gray-600 text-sm mb-4">
              Submit pending bookings to the AADE government portal for tax declaration.
            </p>
            <div class="space-y-4">
              <div class="p-4 bg-green-50 rounded-lg">
                <div class="font-medium text-green-900 mb-2">Submit to AADE</div>
                <p class="text-sm text-green-700 mb-3">Runs the AADE submission agent for all pending bookings</p>
                <div class="text-xs text-green-600 mb-3">
                  <strong>Command:</strong> <code class="bg-green-100 px-2 py-1 rounded">npm run agent</code>
                </div>
                <button onclick="alert('Run in terminal: npm run agent')" class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm w-full">
                  🏛️ Start AADE Submission
                </button>
              </div>
            </div>
          </div>

          <!-- Database Actions -->
          <div class="bg-white rounded-xl shadow p-6">
            <h3 class="text-lg font-semibold mb-4">🗄️ Database Management</h3>
            <p class="text-gray-600 text-sm mb-4">
              Manage the local SQLite database containing all booking records.
            </p>
            <div class="space-y-3">
              <button onclick="resetBookings()" class="bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-2 rounded-lg text-sm w-full">
                🔄 Reset All to PENDING
              </button>
              <button onclick="seedDatabase()" class="bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded-lg text-sm w-full">
                🌱 Seed Mock Data
              </button>
            </div>
          </div>

          <!-- Configuration Info -->
          <div class="bg-white rounded-xl shadow p-6">
            <h3 class="text-lg font-semibold mb-4">⚙️ Configuration</h3>
            <div id="config-info" class="space-y-3 text-sm"></div>
          </div>
        </div>
      </div>
    </main>

    <!-- Footer -->
    <footer class="bg-white border-t py-4">
      <div class="max-w-7xl mx-auto px-4 text-center text-gray-500 text-sm">
        AADE Airbnb Automation System • Built with Stagehand + Browserbase
      </div>
    </footer>
  </div>

  <script>
    const API_BASE = '/api';
    
    // Helper function to fetch with error handling
    async function apiFetch(url) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error('HTTP ' + response.status);
        }
        return await response.json();
      } catch (error) {
        console.error('API Error:', url, error);
        return null;
      }
    }
    
    // Tab switching
    function showTab(tabId) {
      document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
      document.querySelectorAll('.tab-btn').forEach(el => {
        el.classList.remove('active', 'border-primary', 'text-primary');
        el.classList.add('border-transparent', 'text-gray-500');
      });
      
      document.getElementById('tab-' + tabId).classList.remove('hidden');
      const btn = document.querySelector('[data-tab="' + tabId + '"]');
      btn.classList.add('active', 'border-primary', 'text-primary');
      btn.classList.remove('border-transparent', 'text-gray-500');
      
      // Load data for the tab
      if (tabId === 'dashboard') loadDashboard();
      if (tabId === 'bookings') loadBookings();
      if (tabId === 'audit') loadAuditLogs();
      if (tabId === 'actions') loadConfig();
    }
    
    // Load dashboard data
    async function loadDashboard() {
      try {
        const [stats, bookings] = await Promise.all([
          apiFetch(API_BASE + '/stats'),
          apiFetch(API_BASE + '/bookings')
        ]);
        
        if (!stats || !bookings) {
          console.error('Failed to load dashboard data');
          document.getElementById('stat-total').textContent = 'Error';
          return;
        }
        
        // Update stats
        document.getElementById('stat-total').textContent = stats.total || 0;
        document.getElementById('stat-revenue').textContent = '€' + (stats.totalRevenue || 0).toFixed(2);
        document.getElementById('stat-pending').textContent = stats.byStatus?.PENDING?.count || 0;
        document.getElementById('stat-submitted').textContent = 
          (stats.byStatus?.SUBMITTED?.count || 0) + (stats.byStatus?.DRY_RUN_VERIFIED?.count || 0);
        
        // Status breakdown
        const breakdown = document.getElementById('status-breakdown');
        if (stats.byStatus && Object.keys(stats.byStatus).length > 0) {
          breakdown.innerHTML = Object.entries(stats.byStatus).map(([status, data]) => 
            '<div class="status-badge status-' + status + '">' + status + ': ' + data.count + '</div>'
          ).join('');
        } else {
          breakdown.innerHTML = '<div class="text-gray-500">No bookings yet</div>';
        }
        
        // Recent bookings
        const recent = bookings.slice(0, 5);
        document.getElementById('recent-bookings').innerHTML = renderBookingsTable(recent, true);
      } catch (e) {
        console.error('Failed to load dashboard:', e);
      }
    }
    
    // Load all bookings
    async function loadBookings() {
      try {
        const status = document.getElementById('status-filter').value;
        const url = API_BASE + '/bookings' + (status !== 'ALL' ? '?status=' + status : '');
        const bookings = await apiFetch(url);
        if (!bookings) {
          document.getElementById('bookings-table').innerHTML = '<div class="p-8 text-center text-red-500">Failed to load bookings</div>';
          return;
        }
        document.getElementById('bookings-table').innerHTML = renderBookingsTable(bookings, false);
      } catch (e) {
        console.error('Failed to load bookings:', e);
      }
    }
    
    // Render bookings table
    function renderBookingsTable(bookings, compact) {
      if (!bookings || bookings.length === 0) {
        return '<div class="p-8 text-center text-gray-500">No bookings found</div>';
      }
      
      return '<table class="w-full"><thead class="bg-gray-50"><tr>' +
        '<th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Guest</th>' +
        '<th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Platform ID</th>' +
        '<th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Dates</th>' +
        '<th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>' +
        '<th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>' +
        (compact ? '' : '<th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>') +
        '</tr></thead><tbody class="divide-y divide-gray-200">' +
        bookings.map(b => 
          '<tr class="hover:bg-gray-50">' +
          '<td class="px-4 py-3 text-sm font-medium text-gray-900">' + b.guest_name + (b.is_cancelled ? ' <span class="text-red-500">(Cancelled)</span>' : '') + '</td>' +
          '<td class="px-4 py-3 text-sm text-gray-500 font-mono">' + b.platform_id + '</td>' +
          '<td class="px-4 py-3 text-sm text-gray-500">' + b.check_in + ' → ' + b.check_out + '</td>' +
          '<td class="px-4 py-3 text-sm font-medium">€' + (b.total_payout || 0).toFixed(2) + '</td>' +
          '<td class="px-4 py-3"><span class="status-badge status-' + b.status + '">' + b.status + '</span></td>' +
          (compact ? '' : '<td class="px-4 py-3 text-sm"><button onclick="updateStatus(' + b.id + ')" class="text-blue-600 hover:text-blue-800 mr-2">Edit</button><button onclick="deleteBooking(' + b.id + ')" class="text-red-600 hover:text-red-800">Delete</button></td>') +
          '</tr>'
        ).join('') +
        '</tbody></table>';
    }
    
    // Load audit logs
    async function loadAuditLogs() {
      try {
        const logs = await apiFetch(API_BASE + '/audit-logs');
        const container = document.getElementById('audit-logs');
        
        if (!logs || logs.length === 0) {
          container.innerHTML = '<div class="col-span-3 p-8 text-center text-gray-500">No audit logs yet. Run the agents to generate screenshots.</div>';
          return;
        }
        
        container.innerHTML = logs.map(log => 
          '<div class="border rounded-lg overflow-hidden hover:shadow-lg transition-shadow">' +
          '<img src="' + log.url + '" alt="' + log.filename + '" class="w-full h-48 object-cover object-top bg-gray-100" onerror="this.style.display=\\'none\\'" />' +
          '<div class="p-3">' +
          '<div class="font-medium text-sm truncate">' + log.filename + '</div>' +
          '<div class="text-xs text-gray-500">' + new Date(log.createdAt).toLocaleString() + '</div>' +
          (log.bookingId ? '<div class="text-xs text-blue-600">Booking: ' + log.bookingId + '</div>' : '') +
          '</div></div>'
        ).join('');
      } catch (e) {
        console.error('Failed to load audit logs:', e);
      }
    }
    
    // Load configuration
    async function loadConfig() {
      try {
        const config = await apiFetch(API_BASE + '/config');
        if (!config) {
          document.getElementById('config-info').innerHTML = '<div class="text-red-500">Failed to load config</div>';
          return;
        }
        document.getElementById('config-info').innerHTML = 
          '<div class="p-3 bg-gray-50 rounded-lg"><span class="font-medium">Environment:</span> ' + config.environment + '</div>' +
          '<div class="p-3 bg-gray-50 rounded-lg"><span class="font-medium">Dry Run:</span> ' + (config.dryRun ? '✅ Enabled' : '❌ Disabled') + '</div>' +
          '<div class="p-3 bg-gray-50 rounded-lg"><span class="font-medium">Mock Airbnb:</span> <a href="' + config.mockAirbnbUrl + '" target="_blank" class="text-blue-600">' + config.mockAirbnbUrl + '</a></div>' +
          '<div class="p-3 bg-gray-50 rounded-lg"><span class="font-medium">AADE Portal:</span> <a href="' + config.aadeUrl + '" target="_blank" class="text-blue-600">gsis.gr</a></div>';
        
        // Update header badges
        document.getElementById('env-badge').textContent = config.environment;
        if (config.dryRun) {
          document.getElementById('dry-run-badge').classList.remove('hidden');
        }
      } catch (e) {
        console.error('Failed to load config:', e);
      }
    }
    
    // Update booking status
    async function updateStatus(id) {
      const newStatus = prompt('Enter new status (PENDING, SUBMITTED, ERROR, RETRY_LATER):');
      if (!newStatus) return;
      
      try {
        await fetch(API_BASE + '/bookings/' + id + '/status', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus.toUpperCase() })
        });
        loadBookings();
      } catch (e) {
        alert('Failed to update status');
      }
    }
    
    // Delete booking
    async function deleteBooking(id) {
      if (!confirm('Are you sure you want to delete this booking?')) return;
      
      try {
        await fetch(API_BASE + '/bookings/' + id, { method: 'DELETE' });
        loadBookings();
      } catch (e) {
        alert('Failed to delete booking');
      }
    }
    
    // Reset all bookings
    async function resetBookings() {
      if (!confirm('Reset ALL bookings to PENDING status? This is useful for demos.')) return;
      
      try {
        await fetch(API_BASE + '/reset', { method: 'POST' });
        alert('All bookings reset to PENDING');
        loadDashboard();
      } catch (e) {
        alert('Failed to reset bookings');
      }
    }
    
    // Seed database
    function seedDatabase() {
      alert('Run in terminal: npm run seed');
    }
    
    // Initial load
    loadDashboard();
    loadConfig();
  </script>
</body>
</html>`;
}

// Start the server
const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log('');
  console.log('═'.repeat(60));
  console.log('🏛️  AADE AUTOMATION - ADMIN DASHBOARD');
  console.log('═'.repeat(60));
  console.log('');
  console.log(`📊 Dashboard:  http://localhost:${PORT}`);
  console.log(`📡 API:        http://localhost:${PORT}/api`);
  console.log('');
  console.log('Available API endpoints:');
  console.log('  GET  /api/bookings       - List all bookings');
  console.log('  GET  /api/stats          - Get booking statistics');
  console.log('  GET  /api/audit-logs     - List audit screenshots');
  console.log('  GET  /api/config         - Get configuration');
  console.log('  PUT  /api/bookings/:id/status - Update booking status');
  console.log('  DELETE /api/bookings/:id - Delete a booking');
  console.log('  POST /api/reset          - Reset all bookings to PENDING');
  console.log('');
  console.log('═'.repeat(60));
});
