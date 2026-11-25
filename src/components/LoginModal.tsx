import { useState } from 'react';
import { X } from 'lucide-react';
import type { ConfirmationResult } from 'firebase/auth';
import { sendFirebasePhoneOtp, signInWithGooglePopup } from '../lib/firebase';
import type {
  ActiveStaffSession,
  PatientAuthSession,
  PatientProfile,
  StaffRole,
} from '../types/pinnacle';

export type LoginTab = 'patient' | 'owner_admin' | 'doctor' | 'medical';

interface LoginModalProps {
  initialTab?: LoginTab;
  notice?: string | null;
  onClose: () => void;
  onDemoLogin: (name: string, phone?: string, historyConsent?: boolean) => void;
  onPatientAuthSuccess: (session: PatientAuthSession, profile: PatientProfile) => void;
  onStaffLogin: (session: ActiveStaffSession) => void;
}

export function LoginModal({
  initialTab = 'patient',
  notice,
  onClose,
  onDemoLogin,
  onPatientAuthSuccess,
  onStaffLogin,
}: LoginModalProps) {
  const [roleTab, setRoleTab] = useState<LoginTab>(initialTab);
  const [patientMode, setPatientMode] = useState<'login' | 'register'>('login');

  // Patient password login/register state
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('+91');
  const [regAge, setRegAge] = useState('28');
  const [regGender, setRegGender] = useState<'Male' | 'Female' | 'Other'>('Male');
  const [regPassword, setRegPassword] = useState('');

  // Patient OTP / Google state
  const [phone, setPhone] = useState('+91');
  const [otp, setOtp] = useState('');
  const [confirmResult, setConfirmResult] = useState<ConfirmationResult | null>(null);
  const [demoOtpSent, setDemoOtpSent] = useState(false);
  const [historyConsent, setHistoryConsent] = useState(true);

  // Doctor / Medical login state
  const [staffEmail, setStaffEmail] = useState('');
  const [staffPassword, setStaffPassword] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleGoogleLogin = async () => {
    setError(null);
    setBusy(true);
    try {
      await signInWithGooglePopup();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Google sign-in popup was closed or blocked.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handlePatientRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/patients/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: regName.trim(),
          email: regEmail.trim(),
          phone: regPhone.trim(),
          age: Number(regAge) || 28,
          gender: regGender,
          password: regPassword,
          historyConsent,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not create patient account.');
        return;
      }
      onPatientAuthSuccess(data.session, data.profile);
      onClose();
    } catch (err) {
      console.error('Patient registration failed:', err);
      setError('Network error while registering patient account.');
    } finally {
      setBusy(false);
    }
  };

  const handlePatientPasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/patients/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: loginIdentifier.trim(),
          password: loginPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Invalid email or password.');
        return;
      }
      onPatientAuthSuccess(data.session, data.profile);
      onClose();
    } catch (err) {
      console.error('Patient login failed:', err);
      setError('Network error while signing in.');
    } finally {
      setBusy(false);
    }
  };

  const handleSendOtp = async () => {
    setError(null);
    const cleaned = phone.trim();
    if (!/^\+\d{10,14}$/.test(cleaned)) {
      setError('Enter phone number with country code, e.g. +919822012345');
      return;
    }
    setBusy(true);
    try {
      const res = await sendFirebasePhoneOtp(cleaned, 'firebase-recaptcha-container');
      setConfirmResult(res);
    } catch {
      const apiRes = await fetch('/api/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: cleaned }),
      });
      if (apiRes.ok) {
        setDemoOtpSent(true);
      } else {
        setError('Could not send OTP. Check phone number format.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyOtp = async () => {
    setError(null);
    setBusy(true);
    try {
      if (confirmResult) {
        await confirmResult.confirm(otp.trim());
        onClose();
        return;
      }
      const res = await fetch('/api/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), otp: otp.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Invalid OTP.');
        setBusy(false);
        return;
      }
      onDemoLogin(`Patient (${phone.slice(-4)})`, phone.trim(), historyConsent);
      onClose();
    } catch {
      setError('Invalid verification code.');
    } finally {
      setBusy(false);
    }
  };

  const handleStaffLoginSubmit = async (e: React.FormEvent, role: StaffRole) => {
    e.preventDefault();
    setError(null);
    if (!staffEmail.trim() || !staffPassword) {
      setError('Enter your hospital-issued email and passcode.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/staff/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: staffEmail.trim(),
          password: staffPassword,
          role,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Login failed.');
        setBusy(false);
        return;
      }
      onStaffLogin(data.session);
      onClose();
    } catch {
      setError('Network error while signing in.');
    } finally {
      setBusy(false);
    }
  };

  const switchRoleTab = (next: LoginTab) => {
    setRoleTab(next);
    setError(null);
    setStaffEmail('');
    setStaffPassword('');
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-modal-title"
    >
      <div className="bg-white border border-[#E2E6EC] rounded-md w-full max-w-md p-5 space-y-4 my-auto max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 id="login-modal-title" className="text-lg font-semibold text-[#111827]">
            Sign in to Pinnacle
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center border border-[#E2E6EC] rounded text-[#4B5563]"
            aria-label="Close login modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {notice && (
          <div className="p-2.5 bg-[#EFF6FF] border border-[#BFDBFE] text-[#1E40AF] text-xs rounded">
            {notice}
          </div>
        )}

        {/* 4 Separate Role Selector Tabs */}
        <div
          className="grid grid-cols-4 border border-[#D1D5DB] rounded overflow-hidden text-[11px] sm:text-xs font-semibold"
          role="tablist"
          aria-label="Login role options"
        >
          <button
            type="button"
            role="tab"
            aria-selected={roleTab === 'patient'}
            onClick={() => switchRoleTab('patient')}
            data-testid="login-tab-patient"
            className={`py-2 px-1.5 text-center ${
              roleTab === 'patient'
                ? 'bg-[#1F5FA8] text-white'
                : 'bg-[#F9FAFB] text-[#374151] hover:bg-[#F3F4F6]'
            }`}
          >
            Patient
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={roleTab === 'owner_admin'}
            onClick={() => switchRoleTab('owner_admin')}
            data-testid="login-tab-owner-admin"
            className={`py-2 px-1.5 text-center border-l border-[#D1D5DB] ${
              roleTab === 'owner_admin'
                ? 'bg-[#1F5FA8] text-white'
                : 'bg-[#F9FAFB] text-[#374151] hover:bg-[#F3F4F6]'
            }`}
          >
            Desk / Admin
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={roleTab === 'doctor'}
            onClick={() => switchRoleTab('doctor')}
            data-testid="login-tab-doctor"
            className={`py-2 px-1.5 text-center border-l border-[#D1D5DB] ${
              roleTab === 'doctor'
                ? 'bg-[#1F5FA8] text-white'
                : 'bg-[#F9FAFB] text-[#374151] hover:bg-[#F3F4F6]'
            }`}
          >
            Doctor
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={roleTab === 'medical'}
            onClick={() => switchRoleTab('medical')}
            data-testid="login-tab-medical"
            className={`py-2 px-1.5 text-center border-l border-[#D1D5DB] ${
              roleTab === 'medical'
                ? 'bg-[#1F5FA8] text-white'
                : 'bg-[#F9FAFB] text-[#374151] hover:bg-[#F3F4F6]'
            }`}
          >
            Medical
          </button>
        </div>

        {error && (
          <div className="p-2.5 bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C] text-xs rounded">
            {error}
          </div>
        )}

        {roleTab === 'patient' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 border border-[#E2E6EC] rounded overflow-hidden text-xs font-semibold">
              <button
                type="button"
                onClick={() => {
                  setPatientMode('login');
                  setError(null);
                }}
                data-testid="patient-subtab-login"
                className={`py-1.5 text-center ${
                  patientMode === 'login' ? 'bg-[#EFF6FF] text-[#1F5FA8]' : 'bg-white text-[#4B5563]'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setPatientMode('register');
                  setError(null);
                }}
                data-testid="patient-subtab-register"
                className={`py-1.5 text-center border-l border-[#E2E6EC] ${
                  patientMode === 'register' ? 'bg-[#EFF6FF] text-[#1F5FA8]' : 'bg-white text-[#4B5563]'
                }`}
              >
                Register New Patient
              </button>
            </div>

            {patientMode === 'register' ? (
              <form onSubmit={handlePatientRegister} className="space-y-2.5">
                <div>
                  <label htmlFor="reg-name" className="block text-xs font-medium text-[#374151] mb-1">
                    Full Name *
                  </label>
                  <input
                    id="reg-name"
                    type="text"
                    required
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    placeholder="e.g. Rohan Kulkarni"
                    className="w-full h-9 px-3 border border-[#D1D5DB] rounded text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="reg-email" className="block text-xs font-medium text-[#374151] mb-1">
                      Email *
                    </label>
                    <input
                      id="reg-email"
                      type="email"
                      required
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      placeholder="rohan@example.com"
                      className="w-full h-9 px-3 border border-[#D1D5DB] rounded text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="reg-phone" className="block text-xs font-medium text-[#374151] mb-1">
                      Mobile *
                    </label>
                    <input
                      id="reg-phone"
                      type="tel"
                      required
                      value={regPhone}
                      onChange={(e) => setRegPhone(e.target.value)}
                      placeholder="+919822011223"
                      className="w-full h-9 px-3 border border-[#D1D5DB] rounded text-sm"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="reg-age" className="block text-xs font-medium text-[#374151] mb-1">
                      Age *
                    </label>
                    <input
                      id="reg-age"
                      type="number"
                      min={0}
                      max={120}
                      required
                      value={regAge}
                      onChange={(e) => setRegAge(e.target.value)}
                      className="w-full h-9 px-3 border border-[#D1D5DB] rounded text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="reg-gender" className="block text-xs font-medium text-[#374151] mb-1">
                      Gender *
                    </label>
                    <select
                      id="reg-gender"
                      value={regGender}
                      onChange={(e) => setRegGender(e.target.value as 'Male' | 'Female' | 'Other')}
                      className="w-full h-9 px-2 border border-[#D1D5DB] rounded text-sm bg-white"
                    >
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label htmlFor="reg-pass" className="block text-xs font-medium text-[#374151] mb-1">
                    Password (min 6 chars) *
                  </label>
                  <input
                    id="reg-pass"
                    type="password"
                    required
                    minLength={6}
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="Create a password"
                    className="w-full h-9 px-3 border border-[#D1D5DB] rounded text-sm"
                  />
                </div>
                <label className="flex items-start gap-2 pt-1 text-xs text-[#374151] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={historyConsent}
                    onChange={(e) => setHistoryConsent(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-[#1F5FA8]"
                  />
                  <span>
                    I allow doctors I visit through this app to view my medical history.{' '}
                    <span className="text-[#6B7280]">(You can turn this off anytime in settings.)</span>
                  </span>
                </label>
                <button
                  type="submit"
                  disabled={busy}
                  data-testid="patient-register-submit"
                  className="w-full h-10 bg-[#1F5FA8] hover:bg-[#184C87] text-white text-sm font-semibold rounded disabled:opacity-60"
                >
                  {busy ? 'Creating PID & Account...' : 'Create Account & Generate PID'}
                </button>
              </form>
            ) : (
              <>
                <form onSubmit={handlePatientPasswordLogin} className="space-y-2.5">
                  <div>
                    <label htmlFor="pat-login-id" className="block text-xs font-medium text-[#374151] mb-1">
                      Registered Email or Mobile
                    </label>
                    <input
                      id="pat-login-id"
                      type="text"
                      required
                      value={loginIdentifier}
                      onChange={(e) => setLoginIdentifier(e.target.value)}
                      placeholder="patient@example.com"
                      className="w-full h-9 px-3 border border-[#D1D5DB] rounded text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="pat-login-pw" className="block text-xs font-medium text-[#374151] mb-1">
                      Password
                    </label>
                    <input
                      id="pat-login-pw"
                      type="password"
                      required
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="Enter password"
                      className="w-full h-9 px-3 border border-[#D1D5DB] rounded text-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={busy}
                    data-testid="patient-login-submit"
                    className="w-full h-9 bg-[#1F5FA8] hover:bg-[#184C87] text-white text-xs font-semibold rounded disabled:opacity-60"
                  >
                    {busy ? 'Signing in...' : 'Sign In as Patient'}
                  </button>
                </form>

                <div className="border-t border-[#E2E6EC] pt-3 space-y-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleGoogleLogin}
                    className="w-full h-10 border border-[#D1D5DB] bg-white hover:bg-[#F5F6F8] text-sm font-medium text-[#111827] rounded"
                  >
                    Continue with Google
                  </button>
                </div>

                <div className="border-t border-[#E2E6EC] pt-3 space-y-2">
                  <label htmlFor="login-phone" className="block text-xs font-medium text-[#374151]">
                    Or Quick Mobile OTP Login
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="login-phone"
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+919822012345"
                      className="flex-1 h-9 px-3 border border-[#D1D5DB] rounded text-sm"
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleSendOtp}
                      className="px-3 h-9 border border-[#1F5FA8] text-[#1F5FA8] bg-white text-xs font-medium rounded hover:bg-[#EFF6FF] whitespace-nowrap"
                    >
                      Send OTP
                    </button>
                  </div>

                  {(confirmResult || demoOtpSent) && (
                    <div className="space-y-1.5">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={otp}
                          onChange={(e) => setOtp(e.target.value)}
                          placeholder="Enter 6-digit OTP"
                          className="flex-1 h-9 px-3 border border-[#D1D5DB] rounded text-sm"
                        />
                        <button
                          type="button"
                          disabled={busy}
                          onClick={handleVerifyOtp}
                          className="px-4 h-9 bg-[#15803D] text-white text-xs font-medium rounded hover:bg-[#166534]"
                        >
                          Verify
                        </button>
                      </div>
                      {demoOtpSent && (
                        <p className="text-[11px] text-[#4B5563]">
                          Preview OTP fallback active (Demo OTP: 123456).
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {roleTab === 'owner_admin' && (
          <div className="space-y-3">
            <div className="p-3 bg-[#F5F6F8] border border-[#E2E6EC] rounded text-xs text-[#374151] space-y-1">
              <p className="font-semibold text-[#111827]">
                Hospital Desk Owner & Admin Sign-In
              </p>
              <p>
                Hospital Desk and Admin dashboards are strictly locked to verified Google accounts authorized for this platform.
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={handleGoogleLogin}
              data-testid="owner-admin-google-btn"
              className="w-full h-10 bg-[#1F5FA8] hover:bg-[#184C87] text-white text-sm font-semibold rounded disabled:opacity-60"
            >
              {busy ? 'Verifying Google Account...' : 'Sign in with Google'}
            </button>
          </div>
        )}

        {(roleTab === 'doctor' || roleTab === 'medical') && (
          <form
            onSubmit={(e) => void handleStaffLoginSubmit(e, roleTab)}
            className="space-y-3"
          >
            <div className="p-2.5 bg-[#F5F6F8] border border-[#E2E6EC] rounded text-xs text-[#4B5563]">
              {roleTab === 'doctor'
                ? 'Doctor accounts are created by your hospital owner in Hospital Desk. Self-registration is disabled.'
                : 'Medical / Pharmacy staff accounts are created by your hospital owner and linked only to that hospital.'}
            </div>

            <div>
              <label htmlFor="staff-email" className="block text-xs font-medium text-[#374151] mb-1">
                Hospital-Issued Email
              </label>
              <input
                id="staff-email"
                type="email"
                required
                value={staffEmail}
                onChange={(e) => setStaffEmail(e.target.value)}
                placeholder={
                  roleTab === 'doctor' ? 'dr.kavita@pinnacle.in' : 'pharmacy@pinnacle.in'
                }
                className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm"
              />
            </div>

            <div>
              <label htmlFor="staff-passcode" className="block text-xs font-medium text-[#374151] mb-1">
                Passcode
              </label>
              <input
                id="staff-passcode"
                type="password"
                required
                value={staffPassword}
                onChange={(e) => setStaffPassword(e.target.value)}
                placeholder="Enter passcode"
                className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              data-testid={`staff-login-submit-${roleTab}`}
              className="w-full h-10 bg-[#1F5FA8] hover:bg-[#184C87] text-white text-sm font-semibold rounded disabled:opacity-60"
            >
              {busy
                ? 'Signing in...'
                : roleTab === 'doctor'
                  ? 'Sign in to Doctor Workspace'
                  : 'Sign in to Medical Desk'}
            </button>

            <div className="text-[11px] text-[#6B7280] bg-[#F9FAFB] border border-[#E2E6EC] rounded p-2">
              {roleTab === 'doctor'
                ? 'Demo Doctor: dr.kavita@pinnacle.in / Doctor@123'
                : 'Demo Medical: pharmacy@pinnacle.in / Medical@123'}
            </div>
          </form>
        )}

        <div id="firebase-recaptcha-container" />
      </div>
    </div>
  );
}
