import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { CheckCircle2, Droplets, PhoneCall, Plus, ShieldAlert, ShieldCheck, Trash2, User } from 'lucide-react';
import type { BloodGroup, EmergencyContact, PatientProfile } from '../types/pinnacle';
import { BLOOD_GROUPS, sanitizePatientProfile } from '../utils/history';
import { deriveDeterministicPidForUid } from '../utils/pid';

interface MyProfileViewProps {
  profile: PatientProfile;
  isFirebaseAuthenticated: boolean;
  onSaveProfile: (updated: PatientProfile) => Promise<void>;
}

const COMMON_ALLERGIES = [
  'Penicillin',
  'Sulfa drugs',
  'Aspirin / NSAIDs',
  'Latex',
  'Dust / Pollen',
  'Peanuts / Nuts',
  'Seafood',
];

const RELATIONS = ['Spouse', 'Parent', 'Child', 'Sibling', 'Friend', 'Guardian'];

export function MyProfileView({
  profile,
  isFirebaseAuthenticated,
  onSaveProfile,
}: MyProfileViewProps) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [age, setAge] = useState(profile.age !== undefined ? String(profile.age) : '');
  const [gender, setGender] = useState<'Male' | 'Female' | 'Other'>(profile.gender);
  const [phone, setPhone] = useState(profile.phone);
  const [email, setEmail] = useState(profile.email);
  const [bloodGroup, setBloodGroup] = useState<BloodGroup>(profile.bloodGroup);
  const [allergies, setAllergies] = useState<string[]>(profile.allergies);
  const [newAllergy, setNewAllergy] = useState('');
  const [allergyNotes, setAllergyNotes] = useState(profile.allergyNotes);
  const [chronicConditions, setChronicConditions] = useState(profile.chronicConditions);
  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyContact[]>(
    profile.emergencyContacts
  );
  const [historyConsent, setHistoryConsent] = useState<boolean>(
    profile.historyConsent ?? true
  );

  // New emergency contact draft
  const [contactName, setContactName] = useState('');
  const [contactRelation, setContactRelation] = useState('Spouse');
  const [contactPhone, setContactPhone] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedBanner, setSavedBanner] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(profile.displayName);
    setAge(profile.age !== undefined ? String(profile.age) : '');
    setGender(profile.gender);
    setPhone(profile.phone);
    setEmail(profile.email);
    setBloodGroup(profile.bloodGroup);
    setAllergies(profile.allergies);
    setAllergyNotes(profile.allergyNotes);
    setChronicConditions(profile.chronicConditions);
    setEmergencyContacts(profile.emergencyContacts);
    setHistoryConsent(profile.historyConsent ?? true);
  }, [profile]);

  const permanentPid = profile.pid || deriveDeterministicPidForUid(profile.uid);

  const handleAddAllergy = (tag: string) => {
    const clean = tag.trim().slice(0, 60);
    if (!clean) return;
    if (allergies.some((a) => a.toLowerCase() === clean.toLowerCase())) {
      setNewAllergy('');
      return;
    }
    if (allergies.length >= 15) {
      setError('You can save up to 15 allergy tags.');
      return;
    }
    setError(null);
    setAllergies((prev) => [...prev, clean]);
    setNewAllergy('');
  };

  const handleRemoveAllergy = (tag: string) => {
    setAllergies((prev) => prev.filter((a) => a !== tag));
  };

  const handleAddEmergencyContact = () => {
    setError(null);
    if (emergencyContacts.length >= 3) {
      setError('You can store up to 3 emergency contacts.');
      return;
    }
    if (contactName.trim().length < 2) {
      setError('Enter the emergency contact’s full name (at least 2 characters).');
      return;
    }
    const digits = contactPhone.replace(/[^\d+]/g, '');
    if (digits.length < 10) {
      setError('Enter a valid 10-digit emergency contact phone number.');
      return;
    }
    setEmergencyContacts((prev) => [
      ...prev,
      {
        name: contactName.trim().slice(0, 80),
        relation: contactRelation,
        phone: contactPhone.trim().slice(0, 20),
      },
    ]);
    setContactName('');
    setContactPhone('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSavedBanner(null);

    if (displayName.trim().length < 2) {
      setError('Please enter your full name.');
      return;
    }

    setSaving(true);
    try {
      const next = sanitizePatientProfile(profile.uid, {
        uid: profile.uid,
        pid: permanentPid,
        historyConsent,
        displayName,
        age: age ? Number(age) : undefined,
        gender,
        phone,
        email,
        bloodGroup,
        allergies,
        allergyNotes,
        chronicConditions,
        emergencyContacts,
      });
      await onSaveProfile(next);
      setSavedBanner(
        isFirebaseAuthenticated
          ? 'Profile saved to your private Pinnacle account and ready to pre-fill future OPD bookings.'
          : 'Profile saved and ready to pre-fill future OPD bookings.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save profile right now.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="bg-white border border-[#E2E6EC] rounded-md p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#111827] flex items-center gap-2">
            <User className="w-5 h-5 text-[#1F5FA8]" aria-hidden="true" />
            My Patient Profile
          </h1>
          <p className="text-sm text-[#4B5563] mt-0.5">
            Store your blood group, allergies, and emergency contacts for faster OPD check-ins across Nagpur.
          </p>
        </div>
        <div className="text-xs px-2.5 py-1.5 bg-[#F5F6F8] border border-[#E2E6EC] rounded text-[#374151]">
          {isFirebaseAuthenticated ? 'Synced with Firebase Private Vault' : 'Local & Session Profile'}
        </div>
      </div>

      {error && (
        <div className="p-3.5 bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C] text-sm rounded-md">
          {error}
        </div>
      )}

      {savedBanner && (
        <div className="p-3.5 bg-[#ECFDF5] border border-[#BBF7D0] text-[#15803D] text-sm rounded-md flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{savedBanner}</span>
        </div>
      )}

      {/* Permanent Health ID ("PID") & QR Code Card */}
      <section
        className="bg-white border border-[#E2E6EC] rounded-md p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        data-testid="patient-pid-card"
      >
        <div className="space-y-2 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-[#1F5FA8]">
            Permanent Patient Health ID
          </div>
          <div
            className="text-2xl font-bold text-[#111827] tracking-tight tabular-nums"
            data-testid="patient-pid-value"
          >
            {permanentPid}
          </div>
          <p className="text-xs text-[#4B5563]">
            Show this PID or QR code at any Pinnacle clinic or pharmacy. Your PID is permanent, never changed, and never reused.
          </p>

          <label className="mt-2 p-3 bg-[#F9FAFB] border border-[#E2E6EC] rounded flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={historyConsent}
              onChange={(e) => setHistoryConsent(e.target.checked)}
              data-testid="profile-history-consent-toggle"
              className="mt-0.5 w-4 h-4 accent-[#1F5FA8]"
            />
            <span className="text-xs text-[#111827]">
              <span className="font-semibold inline-flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-[#1F5FA8]" aria-hidden="true" />
                I allow doctors I visit through this app to view my medical history.
              </span>
              <span className="block text-[#6B7280] mt-0.5">
                Doctors can view your past visits only while you are in their hospital&apos;s active queue. Save Profile to apply changes.
              </span>
            </span>
          </label>
        </div>

        <div
          className="p-3 bg-white border border-[#E2E6EC] rounded flex flex-col items-center gap-1.5 self-start sm:self-center shrink-0"
          data-testid="patient-pid-qr"
        >
          <QRCodeSVG
            value={JSON.stringify({ pid: permanentPid, name: displayName || profile.displayName })}
            size={104}
          />
          <span className="text-[11px] font-semibold text-[#374151] tabular-nums">
            {permanentPid}
          </span>
        </div>
      </section>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Section 1: Basic Patient Info */}
        <section className="bg-white border border-[#E2E6EC] rounded-md p-4 sm:p-5 space-y-4">
          <h2 className="text-sm font-semibold text-[#111827]">Basic Patient Information</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="sm:col-span-2">
              <label htmlFor="prof-name" className="block text-xs font-medium text-[#374151] mb-1">
                Full Name *
              </label>
              <input
                id="prof-name"
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Enter your full name"
                className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm text-[#111827]"
              />
            </div>

            <div>
              <label htmlFor="prof-age" className="block text-xs font-medium text-[#374151] mb-1">
                Age (Years)
              </label>
              <input
                id="prof-age"
                type="number"
                min={0}
                max={120}
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder="e.g. 34"
                className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm text-[#111827] tabular-nums"
              />
            </div>

            <div>
              <label htmlFor="prof-gender" className="block text-xs font-medium text-[#374151] mb-1">
                Gender
              </label>
              <select
                id="prof-gender"
                value={gender}
                onChange={(e) => setGender(e.target.value as 'Male' | 'Female' | 'Other')}
                className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm text-[#111827] bg-white"
              >
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div>
              <label htmlFor="prof-phone" className="block text-xs font-medium text-[#374151] mb-1">
                Mobile Number
              </label>
              <input
                id="prof-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98XXXXXXXX"
                className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm text-[#111827]"
              />
            </div>

            <div>
              <label htmlFor="prof-email" className="block text-xs font-medium text-[#374151] mb-1">
                Email Address
              </label>
              <input
                id="prof-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="patient@example.in"
                className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm text-[#111827]"
              />
            </div>
          </div>
        </section>

        {/* Section 2: Blood Group, Allergies & Medical Summary */}
        <section className="bg-white border border-[#E2E6EC] rounded-md p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[#111827] flex items-center gap-1.5">
              <Droplets className="w-4 h-4 text-[#B91C1C]" aria-hidden="true" />
              Blood Group &amp; Allergies
            </h2>
            <span className="text-xs font-semibold px-2.5 py-1 rounded bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C] tabular-nums">
              Blood Group: {bloodGroup}
            </span>
          </div>

          <div>
            <span className="block text-xs font-medium text-[#374151] mb-1.5">
              Select Blood Group
            </span>
            <div className="grid grid-cols-3 sm:grid-cols-9 gap-2" role="group" aria-label="Blood Group">
              {BLOOD_GROUPS.map((bg) => (
                <button
                  key={bg}
                  type="button"
                  onClick={() => setBloodGroup(bg)}
                  className={`h-10 text-xs font-semibold rounded border transition-colors ${
                    bloodGroup === bg
                      ? 'bg-[#1F5FA8] text-white border-[#1F5FA8]'
                      : 'bg-white text-[#374151] border-[#D1D5DB] hover:bg-[#F5F6F8]'
                  }`}
                >
                  {bg}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="prof-new-allergy" className="block text-xs font-medium text-[#374151] mb-1">
              Known Drug, Food, or Environmental Allergies ({allergies.length}/15)
            </label>
            <div className="flex gap-2">
              <input
                id="prof-new-allergy"
                type="text"
                maxLength={60}
                value={newAllergy}
                onChange={(e) => setNewAllergy(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddAllergy(newAllergy);
                  }
                }}
                placeholder="Type an allergy (e.g. Penicillin, Dust, Peanuts)"
                className="flex-1 h-10 px-3 border border-[#D1D5DB] rounded text-sm text-[#111827]"
              />
              <button
                type="button"
                onClick={() => handleAddAllergy(newAllergy)}
                className="inline-flex items-center gap-1 px-3.5 h-10 text-xs font-medium border border-[#1F5FA8] text-[#1F5FA8] bg-white rounded hover:bg-[#EFF6FF]"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                Add Allergy
              </button>
            </div>

            {/* Common quick-add buttons */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {COMMON_ALLERGIES.filter(
                (item) => !allergies.some((a) => a.toLowerCase() === item.toLowerCase())
              ).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => handleAddAllergy(item)}
                  className="px-2.5 py-1 text-xs text-[#4B5563] bg-[#F9FAFB] border border-[#E2E6EC] rounded hover:bg-[#EFF6FF] hover:text-[#1F5FA8]"
                >
                  + {item}
                </button>
              ))}
            </div>

            {/* Saved allergy list */}
            {allergies.length > 0 ? (
              <div className="flex flex-wrap gap-2 mt-3" data-testid="saved-allergies-list">
                {allergies.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-[#FFFBEB] border border-[#FDE68A] text-[#92400E] rounded"
                  >
                    <ShieldAlert className="w-3.5 h-3.5 text-[#B45309]" aria-hidden="true" />
                    {tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveAllergy(tag)}
                      aria-label={`Remove allergy ${tag}`}
                      className="text-[#92400E] hover:text-[#B91C1C] font-bold ml-0.5"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[#6B7280] mt-2">No allergies recorded yet.</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label htmlFor="prof-allergy-notes" className="block text-xs font-medium text-[#374151] mb-1">
                Allergy Reaction Notes
              </label>
              <input
                id="prof-allergy-notes"
                type="text"
                maxLength={300}
                value={allergyNotes}
                onChange={(e) => setAllergyNotes(e.target.value)}
                placeholder="e.g. Rash with amoxicillin, carries inhaler"
                className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm text-[#111827]"
              />
            </div>
            <div>
              <label htmlFor="prof-conditions" className="block text-xs font-medium text-[#374151] mb-1">
                Ongoing Conditions / Regular Medications
              </label>
              <input
                id="prof-conditions"
                type="text"
                maxLength={300}
                value={chronicConditions}
                onChange={(e) => setChronicConditions(e.target.value)}
                placeholder="e.g. Mild hypertension, spectacles since 2020"
                className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm text-[#111827]"
              />
            </div>
          </div>
        </section>

        {/* Section 3: Emergency Contacts */}
        <section className="bg-white border border-[#E2E6EC] rounded-md p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[#111827] flex items-center gap-1.5">
              <PhoneCall className="w-4 h-4 text-[#1F5FA8]" aria-hidden="true" />
              Emergency Contacts ({emergencyContacts.length}/3)
            </h2>
          </div>

          {emergencyContacts.length > 0 ? (
            <div className="space-y-2" data-testid="emergency-contacts-list">
              {emergencyContacts.map((contact, idx) => (
                <div
                  key={`${contact.name}-${idx}`}
                  className="p-3 bg-[#F9FAFB] border border-[#E2E6EC] rounded flex items-center justify-between gap-3"
                >
                  <div>
                    <div className="text-sm font-semibold text-[#111827]">
                      {contact.name}{' '}
                      <span className="text-xs font-medium text-[#4B5563]">
                        ({contact.relation})
                      </span>
                    </div>
                    <div className="text-xs text-[#4B5563] tabular-nums">{contact.phone}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setEmergencyContacts((prev) => prev.filter((_, i) => i !== idx))
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border border-[#FECACA] text-[#B91C1C] bg-white rounded hover:bg-[#FEF2F2]"
                    aria-label={`Remove emergency contact ${contact.name}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    Remove
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[#6B7280]">
              No emergency contacts added yet. Add a family member or trusted contact below.
            </p>
          )}

          {emergencyContacts.length < 3 && (
            <div className="p-3 bg-[#F5F6F8] border border-[#E2E6EC] rounded space-y-2.5">
              <div className="text-xs font-semibold text-[#374151]">Add Emergency Contact</div>
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                <div className="sm:col-span-5">
                  <label htmlFor="ec-name" className="block text-[11px] text-[#4B5563] mb-1">
                    Contact Name
                  </label>
                  <input
                    id="ec-name"
                    type="text"
                    maxLength={80}
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="e.g. Priya Deshmukh"
                    className="w-full h-9 px-2.5 bg-white border border-[#D1D5DB] rounded text-xs text-[#111827]"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label htmlFor="ec-relation" className="block text-[11px] text-[#4B5563] mb-1">
                    Relationship
                  </label>
                  <select
                    id="ec-relation"
                    value={contactRelation}
                    onChange={(e) => setContactRelation(e.target.value)}
                    className="w-full h-9 px-2 bg-white border border-[#D1D5DB] rounded text-xs text-[#111827]"
                  >
                    {RELATIONS.map((rel) => (
                      <option key={rel} value={rel}>
                        {rel}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-4 flex gap-2">
                  <div className="flex-1">
                    <label htmlFor="ec-phone" className="block text-[11px] text-[#4B5563] mb-1">
                      Mobile Number
                    </label>
                    <input
                      id="ec-phone"
                      type="tel"
                      maxLength={20}
                      value={contactPhone}
                      onChange={(e) => setContactPhone(e.target.value)}
                      placeholder="+91 98XXXXXXXX"
                      className="w-full h-9 px-2.5 bg-white border border-[#D1D5DB] rounded text-xs text-[#111827]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleAddEmergencyContact}
                    className="self-end h-9 px-3 text-xs font-medium bg-white border border-[#1F5FA8] text-[#1F5FA8] rounded hover:bg-[#EFF6FF] whitespace-nowrap"
                  >
                    + Add Contact
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 text-sm font-medium bg-[#1F5FA8] text-white rounded hover:bg-[#184C87] disabled:opacity-60 min-h-[44px]"
          >
            {saving ? 'Saving Profile...' : 'Save Profile'}
          </button>
        </div>
      </form>
    </div>
  );
}
