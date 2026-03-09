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
  <title>OFFSET - Automated Compliance for Short-Term Rentals</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            primary: '#6EE7B7',
            'primary-dark': '#34D399',
            'primary-light': '#A7F3D0',
            secondary: '#10B981',
            accent: '#F97316',
            dark: '#1A1F2E',
            'dark-lighter': '#242938',
            success: '#22c55e',
            warning: '#f59e0b',
            error: '#ef4444',
          }
        }
      }
    }
  </script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    body { font-family: 'Inter', sans-serif; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .5; } }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
    .animate-pulse { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
    .animate-fadeIn { animation: fadeIn 0.3s ease-out; }
    .status-badge { padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 600; text-transform: uppercase; }
    .status-PENDING { background: #fef3c7; color: #92400e; }
    .status-SUBMITTED { background: #d1fae5; color: #065f46; }
    .status-ERROR { background: #fee2e2; color: #991b1b; }
    .status-RETRY_LATER { background: #e0e7ff; color: #3730a3; }
    .status-DRY_RUN_VERIFIED { background: #dbeafe; color: #1e40af; }
    .status-NEEDS_PROPERTY { background: #fce7f3; color: #9d174d; }
    .gradient-bg { background: linear-gradient(135deg, #f0fdf4 0%, #ecfeff 50%, #f0f9ff 100%); }
    .offset-logo { display: flex; align-items: center; gap: 8px; cursor: pointer; }
    .offset-icon { 
      width: 40px; 
      height: 40px; 
      background: #6EE7B7; 
      border-radius: 50%; 
      display: flex; 
      align-items: center; 
      justify-content: center;
      border: 2px solid #000;
    }
    .offset-icon svg { width: 24px; height: 24px; color: #000; stroke-width: 2; }
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 50; }
    .modal-content { background: white; border-radius: 16px; padding: 32px; max-width: 400px; width: 90%; }
    .btn-primary { background: #1A1F2E; color: white; padding: 12px 24px; border-radius: 8px; font-weight: 500; transition: all 0.2s; }
    .btn-primary:hover { background: #242938; }
    .btn-outline { border: 1px solid #e5e7eb; padding: 12px 24px; border-radius: 8px; font-weight: 500; transition: all 0.2s; }
    .btn-outline:hover { background: #f9fafb; }
    .user-avatar { width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg, #6EE7B7 0%, #34D399 100%); display: flex; align-items: center; justify-content: center; font-weight: 600; color: #1A1F2E; font-size: 14px; }
  </style>
</head>
<body class="bg-gray-50 min-h-screen">
  <div id="app" class="flex flex-col min-h-screen">
    
    <!-- Auth Modal -->
    <div id="auth-modal" class="modal-overlay hidden">
      <div class="modal-content animate-fadeIn">
        <div class="text-center mb-6">
          <div class="offset-logo justify-center mb-4">
            <div class="offset-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/>
                <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              </svg>
            </div>
            <span class="text-2xl font-bold text-gray-900 tracking-wide">OFFSET</span>
          </div>
          <h2 id="auth-title" class="text-xl font-semibold text-gray-900">Welcome Back</h2>
          <p class="text-gray-500 text-sm mt-1">Sign in to manage your properties</p>
        </div>
        
        <form id="auth-form" onsubmit="handleAuth(event)">
          <div id="name-field" class="mb-4 hidden">
            <label class="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
            <input type="text" id="auth-name" class="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary" placeholder="Enter your name">
          </div>
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input type="email" id="auth-email" class="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary" placeholder="you@example.com" required>
          </div>
          <div class="mb-6">
            <label class="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input type="password" id="auth-password" class="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary" placeholder="••••••••" required>
          </div>
          <button type="submit" class="btn-primary w-full mb-4">
            <span id="auth-btn-text">Sign In</span>
          </button>
          <div class="text-center text-sm text-gray-500">
            <span id="auth-switch-text">Don't have an account?</span>
            <button type="button" onclick="toggleAuthMode()" class="text-primary-dark font-medium hover:underline ml-1" id="auth-switch-btn">Sign Up</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Header -->
    <header class="bg-white border-b shadow-sm">
      <div class="max-w-7xl mx-auto px-4 py-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-4">
            <div class="offset-logo" onclick="window.location.reload()">
              <div class="offset-icon">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/>
                  <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                </svg>
              </div>
              <span class="text-2xl font-bold text-gray-900 tracking-wide">OFFSET</span>
            </div>
          </div>
          
          <!-- Auth Buttons / User Menu -->
          <div id="header-auth" class="flex items-center space-x-3">
            <button onclick="showAuthModal('signin')" class="btn-outline text-sm">Sign In</button>
            <button onclick="showAuthModal('signup')" class="btn-primary text-sm">Sign Up</button>
          </div>
          <div id="header-user" class="hidden flex items-center space-x-4">
            <div class="text-right hidden sm:block">
              <div id="user-name" class="text-sm font-medium text-gray-900">Demo User</div>
              <div id="user-properties" class="text-xs text-gray-500">12 Properties</div>
            </div>
            <div class="relative">
              <button onclick="toggleUserMenu()" class="user-avatar" id="user-avatar">DU</button>
              <div id="user-menu" class="hidden absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border py-2 z-10">
                <a href="#" class="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">⚙️ Settings</a>
                <a href="#" class="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">📊 Reports</a>
                <hr class="my-2">
                <button onclick="signOut()" class="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50">🚪 Sign Out</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>

    <!-- Navigation Tabs -->
    <nav id="main-nav" class="bg-white border-b hidden">
      <div class="max-w-7xl mx-auto px-4">
        <div class="flex space-x-8">
          <button onclick="showTab('dashboard')" class="tab-btn active py-4 px-1 border-b-2 border-primary-dark text-gray-900 font-medium" data-tab="dashboard">
            📊 Dashboard
          </button>
          <button onclick="showTab('bookings')" class="tab-btn py-4 px-1 border-b-2 border-transparent text-gray-500 hover:text-gray-900" data-tab="bookings">
            📋 Reservations
          </button>
          <button onclick="showTab('audit')" class="tab-btn py-4 px-1 border-b-2 border-transparent text-gray-500 hover:text-gray-900" data-tab="audit">
            � Audit Trail
          </button>
          <button onclick="showTab('actions')" class="tab-btn py-4 px-1 border-b-2 border-transparent text-gray-500 hover:text-gray-900" data-tab="actions">
            ⚡ Automation
          </button>
        </div>
      </div>
    </nav>

    <!-- Welcome Screen (shown when not logged in) -->
    <div id="welcome-screen" class="flex-1 gradient-bg flex items-center justify-center">
      <div class="text-center max-w-2xl mx-auto px-4 py-16">
        <div class="offset-logo justify-center mb-6">
          <div class="offset-icon" style="width: 64px; height: 64px;">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 36px; height: 36px;">
              <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/>
              <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            </svg>
          </div>
        </div>
        <h1 class="text-4xl font-bold text-gray-900 mb-4">Automated AADE Compliance</h1>
        <p class="text-xl text-gray-600 mb-8">
          Stop wasting hours on manual tax declarations. OFFSET automatically syncs your Airbnb reservations and submits them to AADE.
        </p>
        <div class="flex flex-col sm:flex-row gap-4 justify-center mb-12">
          <button onclick="showAuthModal('signup')" class="btn-primary text-lg px-8 py-4">
            🚀 Get Started Free
          </button>
          <button onclick="demoLogin()" class="btn-outline text-lg px-8 py-4">
            👁️ View Demo
          </button>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-6 text-left">
          <div class="bg-white/80 backdrop-blur rounded-xl p-6 border">
            <div class="text-3xl mb-3">🔗</div>
            <h3 class="font-semibold text-gray-900 mb-2">Connect Platforms</h3>
            <p class="text-sm text-gray-600">Sync Airbnb, Booking.com, and more automatically</p>
          </div>
          <div class="bg-white/80 backdrop-blur rounded-xl p-6 border">
            <div class="text-3xl mb-3">🤖</div>
            <h3 class="font-semibold text-gray-900 mb-2">AI-Powered</h3>
            <p class="text-sm text-gray-600">Our agents handle AADE submissions 24/7</p>
          </div>
          <div class="bg-white/80 backdrop-blur rounded-xl p-6 border">
            <div class="text-3xl mb-3">✅</div>
            <h3 class="font-semibold text-gray-900 mb-2">100% Compliant</h3>
            <p class="text-sm text-gray-600">Never miss a deadline or face penalties</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Main Content (shown when logged in) -->
    <main id="main-content" class="flex-1 max-w-7xl mx-auto px-4 py-6 w-full gradient-bg hidden">
      
      <!-- Dashboard Tab -->
      <div id="tab-dashboard" class="tab-content">
        <!-- Welcome Banner -->
        <div class="bg-gradient-to-r from-dark to-dark-lighter rounded-xl p-6 mb-8 text-white">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="text-2xl font-bold mb-1">Welcome back, <span id="dashboard-user-name">Property Manager</span>! 👋</h2>
              <p class="text-gray-300">Here's your compliance overview for today</p>
            </div>
            <div class="hidden md:block text-right">
              <div class="text-sm text-gray-400">Last sync</div>
              <div class="text-primary font-medium" id="last-sync">Just now</div>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div class="bg-white rounded-xl shadow-sm border p-6 hover:shadow-md transition-shadow">
            <div class="flex items-center justify-between mb-2">
              <div class="text-gray-500 text-sm">Total Reservations</div>
              <span class="text-2xl">📅</span>
            </div>
            <div id="stat-total" class="text-3xl font-bold text-gray-900">-</div>
            <div class="text-xs text-gray-400 mt-1">All time</div>
          </div>
          <div class="bg-white rounded-xl shadow-sm border p-6 hover:shadow-md transition-shadow">
            <div class="flex items-center justify-between mb-2">
              <div class="text-gray-500 text-sm">Total Revenue</div>
              <span class="text-2xl">💰</span>
            </div>
            <div id="stat-revenue" class="text-3xl font-bold text-success">-</div>
            <div class="text-xs text-gray-400 mt-1">Reported to AADE</div>
          </div>
          <div class="bg-white rounded-xl shadow-sm border p-6 hover:shadow-md transition-shadow">
            <div class="flex items-center justify-between mb-2">
              <div class="text-gray-500 text-sm">Pending Submissions</div>
              <span class="text-2xl">⏳</span>
            </div>
            <div id="stat-pending" class="text-3xl font-bold text-warning">-</div>
            <div class="text-xs text-gray-400 mt-1">Awaiting processing</div>
          </div>
          <div class="bg-white rounded-xl shadow-sm border p-6 hover:shadow-md transition-shadow">
            <div class="flex items-center justify-between mb-2">
              <div class="text-gray-500 text-sm">Submitted to AADE</div>
              <span class="text-2xl">✅</span>
            </div>
            <div id="stat-submitted" class="text-3xl font-bold text-primary-dark">-</div>
            <div class="text-xs text-gray-400 mt-1">Successfully declared</div>
          </div>
        </div>

        <!-- Status Breakdown -->
        <div class="bg-white rounded-xl shadow-sm border p-6 mb-8">
          <h3 class="text-lg font-semibold mb-4">Status Breakdown</h3>
          <div id="status-breakdown" class="flex flex-wrap gap-4"></div>
        </div>

        <!-- Recent Activity -->
        <div class="bg-white rounded-xl shadow-sm border p-6">
          <h3 class="text-lg font-semibold mb-4">Recent Bookings</h3>
          <div id="recent-bookings" class="overflow-x-auto"></div>
        </div>
      </div>

      <!-- Bookings Tab -->
      <div id="tab-bookings" class="tab-content hidden">
        <div class="bg-white rounded-xl shadow-sm border">
          <div class="p-4 border-b flex items-center justify-between">
            <h2 class="text-lg font-semibold">All Bookings</h2>
            <div class="flex items-center space-x-2">
              <select id="status-filter" onchange="loadBookings()" class="border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary">
                <option value="ALL">All Statuses</option>
                <option value="PENDING">Pending</option>
                <option value="SUBMITTED">Submitted</option>
                <option value="ERROR">Error</option>
                <option value="RETRY_LATER">Retry Later</option>
                <option value="DRY_RUN_VERIFIED">Dry Run Verified</option>
              </select>
              <button onclick="loadBookings()" class="bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-lg text-sm transition-colors">
                🔄 Refresh
              </button>
            </div>
          </div>
          <div id="bookings-table" class="overflow-x-auto"></div>
        </div>
      </div>

      <!-- Audit Logs Tab -->
      <div id="tab-audit" class="tab-content hidden">
        <div class="bg-white rounded-xl shadow-sm border p-6">
          <div class="flex items-center justify-between mb-4">
            <div>
              <h2 class="text-lg font-semibold">Audit Trail</h2>
              <p class="text-sm text-gray-500">Screenshots and confirmations from AADE submissions</p>
            </div>
            <button onclick="loadAuditLogs()" class="bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-lg text-sm transition-colors">
              🔄 Refresh
            </button>
          </div>
          <div id="audit-logs" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"></div>
        </div>
      </div>

      <!-- Actions Tab -->
      <div id="tab-actions" class="tab-content hidden">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <!-- Sync Platforms -->
          <div class="bg-white rounded-xl shadow-sm border p-6">
            <div class="flex items-center gap-3 mb-4">
              <div class="w-12 h-12 bg-rose-100 rounded-xl flex items-center justify-center">
                <span class="text-2xl">🏠</span>
              </div>
              <div>
                <h3 class="text-lg font-semibold">Sync Platforms</h3>
                <p class="text-sm text-gray-500">Import reservations from connected platforms</p>
              </div>
            </div>
            <div class="space-y-3">
              <div class="p-4 bg-gray-50 rounded-lg flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/Airbnb_Logo_B%C3%A9lo.svg/512px-Airbnb_Logo_B%C3%A9lo.svg.png" alt="Airbnb" class="h-6">
                  <div>
                    <div class="font-medium text-sm">Airbnb</div>
                    <div class="text-xs text-success">Connected</div>
                  </div>
                </div>
                <button onclick="runSync('airbnb')" class="bg-dark hover:bg-dark-lighter text-white px-4 py-2 rounded-lg text-sm transition-colors">
                  Sync Now
                </button>
              </div>
              <div class="p-4 bg-gray-50 rounded-lg flex items-center justify-between opacity-50">
                <div class="flex items-center gap-3">
                  <span class="text-2xl">🅱️</span>
                  <div>
                    <div class="font-medium text-sm">Booking.com</div>
                    <div class="text-xs text-gray-400">Coming Soon</div>
                  </div>
                </div>
                <button disabled class="bg-gray-300 text-gray-500 px-4 py-2 rounded-lg text-sm cursor-not-allowed">
                  Connect
                </button>
              </div>
            </div>
          </div>

          <!-- AADE Submission -->
          <div class="bg-white rounded-xl shadow-sm border p-6">
            <div class="flex items-center gap-3 mb-4">
              <div class="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                <span class="text-2xl">🏛️</span>
              </div>
              <div>
                <h3 class="text-lg font-semibold">Submit to AADE</h3>
                <p class="text-sm text-gray-500">Declare pending reservations to tax authority</p>
              </div>
            </div>
            <div class="p-4 bg-blue-50 rounded-lg mb-4">
              <div class="flex items-center justify-between mb-2">
                <span class="text-sm font-medium text-blue-900">Pending Declarations</span>
                <span id="pending-count" class="text-2xl font-bold text-blue-700">-</span>
              </div>
              <p class="text-xs text-blue-600">Reservations ready for AADE submission</p>
            </div>
            <button onclick="runAadeSubmission()" class="w-full bg-dark hover:bg-dark-lighter text-white px-4 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2">
              <span>🤖</span> Start Automated Submission
            </button>
          </div>

          <!-- Connected Properties -->
          <div class="bg-white rounded-xl shadow-sm border p-6">
            <div class="flex items-center gap-3 mb-4">
              <div class="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
                <span class="text-2xl">🔑</span>
              </div>
              <div>
                <h3 class="text-lg font-semibold">Your Properties</h3>
                <p class="text-sm text-gray-500">Properties linked to your OFFSET account</p>
              </div>
            </div>
            <div class="space-y-2">
              <div class="p-3 bg-gray-50 rounded-lg flex items-center justify-between">
                <div>
                  <div class="font-medium text-sm">Seaside Villa Athens</div>
                  <div class="text-xs text-gray-500">AMA: 12345678</div>
                </div>
                <span class="status-badge status-SUBMITTED">Active</span>
              </div>
              <div class="p-3 bg-gray-50 rounded-lg flex items-center justify-between">
                <div>
                  <div class="font-medium text-sm">City Center Apartment</div>
                  <div class="text-xs text-gray-500">AMA: 87654321</div>
                </div>
                <span class="status-badge status-SUBMITTED">Active</span>
              </div>
              <button class="w-full mt-3 border border-dashed border-gray-300 rounded-lg py-3 text-sm text-gray-500 hover:bg-gray-50 transition-colors">
                + Add Property
              </button>
            </div>
          </div>

          <!-- Account Settings -->
          <div class="bg-white rounded-xl shadow-sm border p-6">
            <div class="flex items-center gap-3 mb-4">
              <div class="w-12 h-12 bg-violet-100 rounded-xl flex items-center justify-center">
                <span class="text-2xl">⚙️</span>
              </div>
              <div>
                <h3 class="text-lg font-semibold">Account Settings</h3>
                <p class="text-sm text-gray-500">Manage your OFFSET preferences</p>
              </div>
            </div>
            <div class="space-y-3">
              <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div class="text-sm">Auto-submit to AADE</div>
                <label class="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked class="sr-only peer">
                  <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-success"></div>
                </label>
              </div>
              <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div class="text-sm">Email Notifications</div>
                <label class="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked class="sr-only peer">
                  <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-success"></div>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- Footer -->
    <footer class="bg-dark text-white py-6">
      <div class="max-w-7xl mx-auto px-4">
        <div class="flex flex-col md:flex-row items-center justify-between gap-4">
          <div class="flex items-center space-x-2">
            <div style="width: 32px; height: 32px; background: #6EE7B7; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 2px solid #fff;">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 18px; height: 18px; color: #000;">
                <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/>
                <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              </svg>
            </div>
            <span class="font-semibold">OFFSET</span>
          </div>
          <div class="text-sm text-gray-400 text-center">
            <span class="italic">"Lead the Change or <span class="text-accent">Lose the Race</span>"</span>
          </div>
          <div class="text-sm text-gray-400">
            Powered by Agentic AI • Stagehand + Browserbase
          </div>
        </div>
      </div>
    </footer>
  </div>

  <script>
    const API_BASE = '/api';
    let currentUser = null;
    let isSignUpMode = false;
    
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
    
    // Auth Modal Functions
    function showAuthModal(mode) {
      isSignUpMode = mode === 'signup';
      updateAuthModal();
      document.getElementById('auth-modal').classList.remove('hidden');
    }
    
    function hideAuthModal() {
      document.getElementById('auth-modal').classList.add('hidden');
    }
    
    function toggleAuthMode() {
      isSignUpMode = !isSignUpMode;
      updateAuthModal();
    }
    
    function updateAuthModal() {
      const nameField = document.getElementById('name-field');
      const title = document.getElementById('auth-title');
      const btnText = document.getElementById('auth-btn-text');
      const switchText = document.getElementById('auth-switch-text');
      const switchBtn = document.getElementById('auth-switch-btn');
      
      if (isSignUpMode) {
        nameField.classList.remove('hidden');
        title.textContent = 'Create Account';
        btnText.textContent = 'Sign Up';
        switchText.textContent = 'Already have an account?';
        switchBtn.textContent = 'Sign In';
      } else {
        nameField.classList.add('hidden');
        title.textContent = 'Welcome Back';
        btnText.textContent = 'Sign In';
        switchText.textContent = "Don't have an account?";
        switchBtn.textContent = 'Sign Up';
      }
    }
    
    function handleAuth(event) {
      event.preventDefault();
      const name = document.getElementById('auth-name').value || 'Demo User';
      const email = document.getElementById('auth-email').value;
      loginUser({ name, email, properties: 2 });
    }
    
    function demoLogin() {
      loginUser({ name: 'Demo User', email: 'demo@offset.gr', properties: 2 });
    }
    
    function loginUser(user) {
      currentUser = user;
      hideAuthModal();
      
      // Update UI
      document.getElementById('welcome-screen').classList.add('hidden');
      document.getElementById('main-content').classList.remove('hidden');
      document.getElementById('main-nav').classList.remove('hidden');
      document.getElementById('header-auth').classList.add('hidden');
      document.getElementById('header-user').classList.remove('hidden');
      
      // Update user info
      const initials = user.name.split(' ').map(n => n[0]).join('').toUpperCase();
      document.getElementById('user-avatar').textContent = initials;
      document.getElementById('user-name').textContent = user.name;
      document.getElementById('user-properties').textContent = user.properties + ' Properties';
      document.getElementById('dashboard-user-name').textContent = user.name.split(' ')[0];
      
      // Load dashboard
      loadDashboard();
    }
    
    function signOut() {
      currentUser = null;
      document.getElementById('welcome-screen').classList.remove('hidden');
      document.getElementById('main-content').classList.add('hidden');
      document.getElementById('main-nav').classList.add('hidden');
      document.getElementById('header-auth').classList.remove('hidden');
      document.getElementById('header-user').classList.add('hidden');
      document.getElementById('user-menu').classList.add('hidden');
    }
    
    function toggleUserMenu() {
      document.getElementById('user-menu').classList.toggle('hidden');
    }
    
    // Close modal when clicking outside
    document.getElementById('auth-modal').addEventListener('click', function(e) {
      if (e.target === this) hideAuthModal();
    });
    
    // Close user menu when clicking outside
    document.addEventListener('click', function(e) {
      const userMenu = document.getElementById('user-menu');
      const avatar = document.getElementById('user-avatar');
      if (!userMenu.contains(e.target) && e.target !== avatar) {
        userMenu.classList.add('hidden');
      }
    });
    
    // Action functions for the new UI
    function runSync(platform) {
      alert('Starting ' + platform.charAt(0).toUpperCase() + platform.slice(1) + ' sync...\\n\\nRun in terminal: npm run ingest:mock');
    }
    
    function runAadeSubmission() {
      alert('Starting AADE submission agent...\\n\\nRun in terminal: npm run agent');
    }
    
    // Tab switching
    function showTab(tabId) {
      document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
      document.querySelectorAll('.tab-btn').forEach(el => {
        el.classList.remove('active', 'border-primary-dark', 'text-gray-900');
        el.classList.add('border-transparent', 'text-gray-500');
      });
      
      document.getElementById('tab-' + tabId).classList.remove('hidden');
      const btn = document.querySelector('[data-tab="' + tabId + '"]');
      btn.classList.add('active', 'border-primary-dark', 'text-gray-900');
      btn.classList.remove('border-transparent', 'text-gray-500');
      
      // Load data for the tab
      if (tabId === 'dashboard') loadDashboard();
      if (tabId === 'bookings') loadBookings();
      if (tabId === 'audit') loadAuditLogs();
      if (tabId === 'actions') loadPendingCount();
    }
    
    // Load pending count for actions tab
    async function loadPendingCount() {
      const stats = await apiFetch(API_BASE + '/stats');
      if (stats && stats.byStatus) {
        document.getElementById('pending-count').textContent = stats.byStatus.PENDING?.count || 0;
      }
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
          container.innerHTML = '<div class="col-span-3 p-8 text-center text-gray-500"><div class="text-4xl mb-4">📸</div><div class="font-medium">No audit logs yet</div><div class="text-sm mt-1">Screenshots will appear here after AADE submissions</div></div>';
          return;
        }
        
        container.innerHTML = logs.map(log => 
          '<div class="border rounded-lg overflow-hidden hover:shadow-lg transition-shadow">' +
          '<img src="' + log.url + '" alt="' + log.filename + '" class="w-full h-48 object-cover object-top bg-gray-100" onerror="this.style.display=\\'none\\'" />' +
          '<div class="p-3">' +
          '<div class="font-medium text-sm truncate">' + log.filename + '</div>' +
          '<div class="text-xs text-gray-500">' + new Date(log.createdAt).toLocaleString() + '</div>' +
          (log.bookingId ? '<div class="text-xs text-success">✓ Booking: ' + log.bookingId + '</div>' : '') +
          '</div></div>'
        ).join('');
      } catch (e) {
        console.error('Failed to load audit logs:', e);
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
    
    // Initial load - just wait for user to sign in or demo
  </script>
</body>
</html>`;
}

// Start the server
const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log('');
  console.log('═'.repeat(60));
  console.log('�  OFFSET - ADMIN DASHBOARD');
  console.log('   "Lead the Change or Lose the Race"');
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
  console.log('Powered by Agentic AI • Stagehand + Browserbase');
  console.log('═'.repeat(60));
});
