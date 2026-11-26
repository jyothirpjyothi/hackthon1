import { useEffect, useState } from 'react';
import { DatabaseBackup, KeyRound, LogOut, Shield, UserPlus } from 'lucide-react';
import type { AuditLogEntry, AuthUser, UserRole } from '../types/prometheus';
import { api, setAuthToken } from '../services/api';

interface SecurityPageProps {
  currentUser: AuthUser | null;
  onUserChanged: (user: AuthUser | null) => void;
}

export function SecurityPage({ currentUser, onUserChanged }: SecurityPageProps) {
  const [adminClaimed, setAdminClaimed] = useState(true);
  const [envPasscodeActive, setEnvPasscodeActive] = useState(false);
  const [health, setHealth] = useState<{
    status: string;
    uptimeSeconds: number;
    databaseAvailable: boolean;
    geminiVisionAvailable: boolean;
    trainedCategories: number;
    apiErrors: number;
    inspectionFailures: number;
  } | null>(null);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);

  // Login / Bootstrap forms
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Create user form (Admin only)
  const [newUsername, setNewUsername] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('Engineer');

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSecurityData = async () => {
    try {
      const [authStatus, healthData] = await Promise.all([api.getAuthStatus(), api.getHealth()]);
      setAdminClaimed(authStatus.adminClaimed);
      setEnvPasscodeActive(authStatus.envPasscodeActive);
      setHealth(healthData);

      if (authStatus.authenticated && authStatus.user) {
        onUserChanged(authStatus.user);
        if (authStatus.user.role === 'Admin') {
          const [uRes, aRes] = await Promise.all([api.listUsers(), api.listAuditLogs()]);
          setUsers(uRes.users);
          setAuditLogs(aRes.logs);
        } else if (authStatus.user.role === 'Engineer') {
          const aRes = await api.listAuditLogs();
          setAuditLogs(aRes.logs);
        }
      }
    } catch {
      // handled gracefully
    }
  };

  useEffect(() => {
    loadSecurityData();
  }, []);

  const handleBootstrapAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      const res = await api.bootstrapAdmin({ username, email, password });
      setAuthToken(res.token);
      onUserChanged(res.user);
      setUsername('');
      setEmail('');
      setPassword('');
      setMessage(`Admin account "${res.user.username}" claimed and signed in.`);
      await loadSecurityData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to claim admin account.');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      const res = await api.login({ username, password });
      setAuthToken(res.token);
      onUserChanged(res.user);
      setUsername('');
      setPassword('');
      setMessage(`Signed in as ${res.user.username} (${res.user.role}).`);
      await loadSecurityData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    }
  };

  const handleSignOut = () => {
    setAuthToken(null);
    onUserChanged(null);
    setUsers([]);
    setAuditLogs([]);
    setMessage('Signed out cleanly. In-memory Bearer session cleared.');
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await api.createUser({
        username: newUsername,
        email: newEmail,
        password: newPassword,
        role: newRole,
      });
      setNewUsername('');
      setNewEmail('');
      setNewPassword('');
      setMessage(`Created ${newRole} account for ${newUsername}.`);
      await loadSecurityData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create user.');
    }
  };

  const handleRoleChange = async (userId: string, role: UserRole) => {
    try {
      await api.updateUserRole(userId, role);
      await loadSecurityData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update role.');
    }
  };

  const handleDownloadBackup = async () => {
    setError(null);
    try {
      await api.downloadAuthenticatedBackup();
      setMessage('SQLite database backup downloaded.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backup download failed.');
    }
  };

  return (
    <div className="space-y-6">
      {/* System Health Telemetry */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4">
          <p className="text-xs text-slate-400">API Health</p>
          <p className="mt-1.5 font-mono text-base font-semibold text-emerald-400">
            {health?.status === 'ok' ? 'HEALTHY' : 'CHECKING'}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4">
          <p className="text-xs text-slate-400">SQLite Database</p>
          <p className="mt-1.5 font-mono text-base font-semibold text-emerald-400">
            {health?.databaseAvailable ? 'CONNECTED' : 'OFFLINE'}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4">
          <p className="text-xs text-slate-400">Gemini Vision</p>
          <p
            className={`mt-1.5 font-mono text-base font-semibold ${
              health?.geminiVisionAvailable ? 'text-sky-400' : 'text-amber-400'
            }`}
          >
            {health?.geminiVisionAvailable ? 'READY' : 'PATCHCORE ONLY'}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4">
          <p className="text-xs text-slate-400">Memory Banks</p>
          <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-white">
            {health?.trainedCategories ?? 0}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4">
          <p className="text-xs text-slate-400">API Errors</p>
          <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-slate-200">
            {health?.apiErrors ?? 0}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4">
          <p className="text-xs text-slate-400">Inspection Failures</p>
          <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-slate-200">
            {health?.inspectionFailures ?? 0}
          </p>
        </div>
      </div>

      {message && (
        <div className="rounded-lg border border-emerald-900/70 bg-emerald-950/40 px-4 py-3 text-xs text-emerald-200">
          {message}
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-lg border border-rose-900/70 bg-rose-950/40 px-4 py-3 text-xs text-rose-200">
          {error}
        </div>
      )}

      {/* Auth / Session Card */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-6 lg:col-span-5">
          {currentUser ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Shield className="h-5 w-5 text-sky-400" aria-hidden="true" />
                  <h2 className="font-display text-base font-semibold text-white">Active Session</h2>
                </div>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:text-white"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                  Sign Out
                </button>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#0b1222] p-4 text-xs space-y-1.5">
                <p className="text-slate-400">
                  Username: <span className="font-mono text-white">{currentUser.username}</span>
                </p>
                <p className="text-slate-400">
                  Email: <span className="text-slate-200">{currentUser.email}</span>
                </p>
                <p className="text-slate-400">
                  Role: <span className="font-semibold text-sky-400">{currentUser.role}</span>
                </p>
              </div>

              {currentUser.role === 'Admin' && (
                <button
                  type="button"
                  onClick={handleDownloadBackup}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:border-sky-500"
                >
                  <DatabaseBackup className="h-4 w-4 text-sky-400" aria-hidden="true" />
                  Download SQLite Database Backup
                </button>
              )}
            </div>
          ) : !adminClaimed ? (
            <form onSubmit={handleBootstrapAdmin} className="space-y-3 text-xs">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-sky-400" aria-hidden="true" />
                <h2 className="font-display text-base font-semibold text-white">
                  First-Run Admin Setup
                </h2>
              </div>
              <p className="text-slate-400">
                No administrator has been claimed yet. Create the initial Admin credentials (salted scrypt hash stored in SQLite). Once claimed, this setup route locks automatically.
              </p>
              <label className="block">
                <span className="text-slate-300">Admin Username</span>
                <input
                  type="text"
                  required
                  minLength={3}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"
                />
              </label>
              <label className="block">
                <span className="text-slate-300">Admin Email</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@factory.local"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"
                />
              </label>
              <label className="block">
                <span className="text-slate-300">Password (min 8 chars)</span>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"
                />
              </label>
              <button
                type="submit"
                className="w-full rounded-lg bg-sky-600 px-4 py-2.5 font-semibold text-white hover:bg-sky-500"
              >
                Claim Admin Account
              </button>
            </form>
          ) : (
            <form onSubmit={handleLogin} className="space-y-3 text-xs">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-sky-400" aria-hidden="true" />
                <h2 className="font-display text-base font-semibold text-white">
                  Sign In (RBAC)
                </h2>
              </div>
              <p className="text-slate-400">
                Sign in with your Admin, Engineer, or Operator account. Session tokens remain strictly in memory.
                {envPasscodeActive ? ' Environment admin passcode override is active for username "admin".' : ''}
              </p>
              <label className="block">
                <span className="text-slate-300">Username or Email</span>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"
                />
              </label>
              <label className="block">
                <span className="text-slate-300">Password</span>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"
                />
              </label>
              <button
                type="submit"
                className="w-full rounded-lg bg-sky-600 px-4 py-2.5 font-semibold text-white hover:bg-sky-500"
              >
                Sign In
              </button>
            </form>
          )}
        </div>

        {/* User Management (Admin) */}
        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-6 lg:col-span-7">
          <h2 className="font-display text-base font-semibold text-white">
            Role-Based Access Control (Admin · Engineer · Operator)
          </h2>
          {currentUser?.role !== 'Admin' ? (
            <p className="mt-3 text-xs text-slate-400">
              Sign in as an Administrator to create team accounts, assign Engineer or Operator roles, download database backups, and inspect full security audit logs.
            </p>
          ) : (
            <div className="mt-4 space-y-5">
              <form onSubmit={handleCreateUser} className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4 text-xs">
                <input
                  type="text"
                  required
                  minLength={3}
                  placeholder="Username"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"
                />
                <input
                  type="email"
                  required
                  placeholder="Email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"
                />
                <input
                  type="password"
                  required
                  minLength={8}
                  placeholder="Password (8+ chars)"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"
                />
                <div className="flex gap-2">
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as UserRole)}
                    aria-label="New user role"
                    className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-white"
                  >
                    <option value="Operator">Operator</option>
                    <option value="Engineer">Engineer</option>
                    <option value="Admin">Admin</option>
                  </select>
                  <button
                    type="submit"
                    aria-label="Add user"
                    className="inline-flex items-center justify-center rounded-lg bg-sky-600 px-3 text-white hover:bg-sky-500"
                  >
                    <UserPlus className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </form>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="py-2 font-medium">User</th>
                      <th className="py-2 font-medium">Email</th>
                      <th className="py-2 font-medium">Role</th>
                      <th className="py-2 font-medium">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td className="py-2 font-mono text-white">{u.username}</td>
                        <td className="py-2 text-slate-300">{u.email}</td>
                        <td className="py-2">
                          <select
                            value={u.role}
                            onChange={(e) => handleRoleChange(u.id, e.target.value as UserRole)}
                            aria-label={`Change role for ${u.username}`}
                            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                          >
                            <option value="Admin">Admin</option>
                            <option value="Engineer">Engineer</option>
                            <option value="Operator">Operator</option>
                          </select>
                        </td>
                        <td className="py-2 font-mono text-slate-500">
                          {new Date(u.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Audit Log Viewer */}
      {auditLogs.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-6">
          <h2 className="font-display text-base font-semibold text-white">Security &amp; Operations Audit Trail</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 font-medium">Timestamp</th>
                  <th className="py-2 font-medium">Actor</th>
                  <th className="py-2 font-medium">Action</th>
                  <th className="py-2 font-medium">Target</th>
                  <th className="py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {auditLogs.slice(0, 25).map((log) => (
                  <tr key={log.id}>
                    <td className="py-2 font-mono text-slate-500 whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2 text-white">
                      {log.actor} · <span className="text-sky-400">{log.role}</span>
                    </td>
                    <td className="py-2 font-mono text-slate-200">{log.action}</td>
                    <td className="py-2 font-mono text-slate-400">{log.target}</td>
                    <td className="py-2 text-slate-300">{log.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
