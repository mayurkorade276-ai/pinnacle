import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import type { Language, StaffRole } from '../types/pinnacle';
import { t } from '../utils/i18n';

export type ActiveTab =
  | 'search'
  | 'appointments'
  | 'records'
  | 'profile'
  | 'register'
  | 'hospital_desk'
  | 'admin'
  | 'doctor_workspace'
  | 'medical_workspace';

interface NavbarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  language: Language;
  onChangeLanguage: (lang: Language) => void;
  userLabel: string | null;
  isPatientSignedIn: boolean;
  isOwner: boolean;
  isAdmin: boolean;
  staffRole?: StaffRole | null;
  onOpenLogin: () => void;
  onLogout: () => void;
  appointmentCount: number;
}

export function Navbar({
  activeTab,
  onSelectTab,
  language,
  onChangeLanguage,
  userLabel,
  isPatientSignedIn,
  isOwner,
  isAdmin,
  staffRole,
  onOpenLogin,
  onLogout,
  appointmentCount,
}: NavbarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems: Array<{ id: ActiveTab; label: string }> = (() => {
    if (staffRole === 'doctor') {
      return [{ id: 'doctor_workspace', label: 'Doctor Workspace' }];
    }
    if (staffRole === 'medical') {
      return [{ id: 'medical_workspace', label: 'Medical Desk' }];
    }
    if (isOwner) {
      return [
        { id: 'hospital_desk', label: t(language, 'navHospitalDesk') },
        { id: 'search', label: t(language, 'navFindDoctors') },
      ];
    }
    if (isAdmin) {
      return [
        { id: 'admin', label: t(language, 'navAdmin') },
        { id: 'search', label: t(language, 'navFindDoctors') },
      ];
    }
    if (isPatientSignedIn) {
      return [
        { id: 'search', label: t(language, 'navFindDoctors') },
        {
          id: 'appointments',
          label:
            appointmentCount > 0
              ? `${t(language, 'navMyAppointments')} (${appointmentCount})`
              : t(language, 'navMyAppointments'),
        },
        { id: 'records', label: t(language, 'navMyHealthRecords') },
        { id: 'profile', label: t(language, 'navMyProfile') },
        { id: 'register', label: t(language, 'navRegisterHospital') },
      ];
    }
    return [
      { id: 'search', label: t(language, 'navFindDoctors') },
      { id: 'register', label: t(language, 'navRegisterHospital') },
    ];
  })();

  const handleNav = (id: ActiveTab) => {
    onSelectTab(id);
    setMobileMenuOpen(false);
  };

  return (
    <header className="bg-white border-b border-[#E2E6EC] sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
        {/* Zone 1: Brand Wordmark */}
        <button
          type="button"
          onClick={() => handleNav(staffRole === 'doctor' ? 'doctor_workspace' : staffRole === 'medical' ? 'medical_workspace' : 'search')}
          className="flex items-center gap-2 text-left shrink-0 whitespace-nowrap min-h-[40px]"
          aria-label="Pinnacle Home"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className="shrink-0"
          >
            <rect x="2" y="2" width="20" height="20" rx="4" fill="#1F5FA8" />
            <path d="M12 6V18M6 12H18" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="square" />
          </svg>
          <span className="text-xl font-bold tracking-tight text-[#1F5FA8]">
            {t(language, 'brand')}
          </span>
        </button>

        {/* Zone 2: Desktop Navigation Links */}
        <nav className="hidden lg:flex items-center gap-4 xl:gap-5" aria-label="Primary Navigation">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNav(item.id)}
                className={`text-sm font-medium whitespace-nowrap shrink-0 py-1.5 border-b-2 transition-colors ${
                  isActive
                    ? 'border-[#1F5FA8] text-[#1F5FA8]'
                    : 'border-transparent text-[#374151] hover:text-[#1F5FA8]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Language Toggle + Single Auth Action */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div
            className="inline-flex items-center border border-[#D1D5DB] rounded bg-[#F9FAFB]"
            role="group"
            aria-label="Language Selector"
          >
            {(['en', 'hi', 'mr'] as Language[]).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => onChangeLanguage(code)}
                className={`px-2 py-1 text-xs font-medium whitespace-nowrap ${
                  language === code
                    ? 'bg-[#1F5FA8] text-white'
                    : 'text-[#374151] hover:bg-[#E5E7EB]'
                }`}
              >
                {code === 'en' ? 'EN' : code === 'hi' ? 'हिं' : 'मर'}
              </button>
            ))}
          </div>

          {userLabel ? (
            <div className="hidden sm:flex items-center gap-2">
              <span className="text-xs text-[#374151] font-medium max-w-[140px] truncate">
                {userLabel}
              </span>
              <button
                type="button"
                onClick={onLogout}
                data-testid="nav-logout-btn"
                className="px-3 py-1.5 text-xs font-medium border border-[#D1D5DB] rounded text-[#374151] bg-white hover:bg-[#F5F6F8] whitespace-nowrap"
              >
                {t(language, 'navLogout')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onOpenLogin}
              data-testid="nav-login-btn"
              className="inline-flex items-center justify-center px-3.5 py-1.5 text-xs sm:text-sm font-medium bg-[#1F5FA8] text-white rounded hover:bg-[#184C87] whitespace-nowrap min-h-[36px]"
            >
              {t(language, 'navLogin')}
            </button>
          )}

          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="lg:hidden inline-flex items-center justify-center min-w-[44px] min-h-[44px] text-[#374151] hover:bg-[#F5F6F8] rounded"
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t border-[#E2E6EC] bg-white px-4 py-3 space-y-1">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNav(item.id)}
                className={`w-full text-left px-3 py-2.5 rounded text-sm font-medium min-h-[44px] ${
                  isActive
                    ? 'bg-[#EFF6FF] text-[#1F5FA8]'
                    : 'text-[#374151] hover:bg-[#F5F6F8]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
          <div className="pt-2 border-t border-[#E2E6EC]">
            {userLabel ? (
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-sm text-[#374151] truncate">{userLabel}</span>
                <button
                  type="button"
                  onClick={() => {
                    onLogout();
                    setMobileMenuOpen(false);
                  }}
                  className="px-3 py-1.5 text-sm font-medium border border-[#D1D5DB] rounded text-[#374151]"
                >
                  {t(language, 'navLogout')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  onOpenLogin();
                  setMobileMenuOpen(false);
                }}
                className="w-full py-2.5 text-sm font-medium bg-[#1F5FA8] text-white rounded min-h-[44px]"
              >
                {t(language, 'navLogin')}
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
