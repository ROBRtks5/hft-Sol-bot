export interface AuditLogEntry {
  timestamp: string;
  action: 'PAUSE' | 'KILL' | 'RESUME';
  operator: string;
  ip: string;
  status: 'SUCCESS' | 'DENIED' | 'RATE_LIMITED' | 'FAILED';
  reason?: string;
}

// In-memory rate limiting and audit history store
const auditLogs: AuditLogEntry[] = [];
const rateLimitMap: Map<string, { count: number; resetAt: number }> = new Map();

export function checkRateLimit(ip: string, maxRequests = 5, windowMs = 60_000): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now > record.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (record.count >= maxRequests) {
    return false;
  }

  record.count += 1;
  return true;
}

export function logAudit(entry: AuditLogEntry) {
  auditLogs.unshift(entry);
  if (auditLogs.length > 500) {
    auditLogs.pop();
  }
}

export function getAuditLogs(): AuditLogEntry[] {
  return [...auditLogs];
}
