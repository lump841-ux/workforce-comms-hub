const { all } = require('../database/db');

// The reliable way to find "who supervises this client" — client_hr users
// are linked to a client_org, and client_org_agency_links maps a client_org
// to the agency's `clients` row (client_id). Going through users.client_id
// directly is NOT reliable: that column is only a session-time convenience
// set when a client_hr user logs in / switches agencies, so a supervisor
// who was just invited and hasn't logged in yet would be missed.
function getSupervisorsForClient(clientId) {
  if (!clientId) return [];
  return all(
    `SELECT DISTINCT u.id, u.full_name, u.email, u.phone
     FROM users u
     JOIN client_org_agency_links l ON l.client_org_id = u.client_org_id
     WHERE u.role = 'client_hr' AND u.active = 1 AND l.client_id = ? AND l.status = 'active'`,
    [clientId]
  );
}

// Simple business-hours heuristic (agency-local convenience, not
// timezone-aware per-office yet): 8:00 AM - 6:00 PM, Mon-Fri counts as
// business hours; everything else (nights, weekends) is after-hours. Good
// enough to flag "this happened when the office was probably closed" for
// the alert center / shift timeline without needing per-office config.
function isAfterHours(date = new Date()) {
  const day = date.getDay(); // 0 = Sunday, 6 = Saturday
  const hour = date.getHours();
  if (day === 0 || day === 6) return true;
  return hour < 8 || hour >= 18;
}

module.exports = { getSupervisorsForClient, isAfterHours };
