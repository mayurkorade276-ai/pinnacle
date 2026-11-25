import { useState } from 'react';
import { MapPin, Search, List, Map as MapIcon, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { SPECIALTIES } from '../data/seedHospitals';
import type {
  BestOptionSummary,
  Coordinates,
  Language,
  RankedHospital,
  SortOption,
  Specialty,
  TransportMode,
} from '../types/pinnacle';
import { NAGPUR_CENTER } from '../utils/ranking';
import { t } from '../utils/i18n';
import { HospitalCard } from './HospitalCard';
import { HospitalMapView } from './HospitalMapView';

interface HomeSearchViewProps {
  language: Language;
  specialty: Specialty | 'All';
  onChangeSpecialty: (s: Specialty | 'All') => void;
  city: string;
  onChangeCity: (c: string) => void;
  userLocation: Coordinates;
  onChangeUserLocation: (coords: Coordinates, label?: string) => void;
  transportMode: TransportMode;
  onChangeTransportMode: (m: TransportMode) => void;
  sortBy: SortOption;
  onChangeSortBy: (s: SortOption) => void;
  openNowOnly: boolean;
  onChangeOpenNowOnly: (v: boolean) => void;
  sponsored: RankedHospital[];
  organic: RankedHospital[];
  bestOption: BestOptionSummary | null;
  loading: boolean;
  error: string | null;
  onSearch: () => void;
  onBook: (item: RankedHospital) => void;
  nowMs: number;
  quotaExceeded: boolean;
}

export function HomeSearchView({
  language,
  specialty,
  onChangeSpecialty,
  city,
  onChangeCity,
  userLocation,
  onChangeUserLocation,
  transportMode,
  onChangeTransportMode,
  sortBy,
  onChangeSortBy,
  openNowOnly,
  onChangeOpenNowOnly,
  sponsored,
  organic,
  bestOption,
  loading,
  error,
  onSearch,
  onBook,
  nowMs,
  quotaExceeded,
}: HomeSearchViewProps) {
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [locating, setLocating] = useState(false);
  const [locationNotice, setLocationNotice] = useState<string | null>(null);

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      onChangeUserLocation(NAGPUR_CENTER, 'Nagpur');
      setLocationNotice('Using central Nagpur coordinates (Sitabuldi).');
      return;
    }
    setLocating(true);
    setLocationNotice(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        onChangeUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocationNotice('Location updated using device GPS.');
      },
      () => {
        setLocating(false);
        onChangeUserLocation(NAGPUR_CENTER);
        setLocationNotice('GPS unavailable. Using Sitabuldi, Nagpur as starting point.');
      },
      { timeout: 6000 }
    );
  };

  const allMapItems = [...sponsored, ...organic].filter(
    (item, idx, arr) => arr.findIndex((x) => x.hospital.id === item.hospital.id) === idx
  );

  return (
    <div className="space-y-5">
      {/* Plain, Practical Search Section */}
      <section className="bg-white border border-[#E2E6EC] rounded-md p-4 sm:p-6">
        <div className="max-w-4xl">
          <h1 className="text-xl sm:text-2xl font-bold text-[#111827] leading-tight">
            {t(language, 'searchHeading')}
          </h1>
          <p className="text-sm text-[#4B5563] mt-1">
            {t(language, 'searchSubheading')}
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSearch();
          }}
          className="mt-4 grid grid-cols-1 md:grid-cols-12 gap-3 items-end"
        >
          {/* Specialty Dropdown */}
          <div className="md:col-span-4">
            <label
              htmlFor="search-specialty"
              className="block text-xs font-medium text-[#374151] mb-1"
            >
              {t(language, 'specialtyLabel')}
            </label>
            <select
              id="search-specialty"
              value={specialty}
              onChange={(e) => onChangeSpecialty(e.target.value as Specialty | 'All')}
              className="w-full h-11 px-3 bg-white border border-[#D1D5DB] rounded text-sm text-[#111827]"
            >
              {SPECIALTIES.map((sp) => (
                <option key={sp} value={sp}>
                  {sp}
                </option>
              ))}
              <option value="All">All Specialties</option>
            </select>
          </div>

          {/* City / Area Input + Use My Location */}
          <div className="md:col-span-5">
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor="search-city"
                className="block text-xs font-medium text-[#374151]"
              >
                {t(language, 'cityLabel')}
              </label>
              <button
                type="button"
                onClick={handleUseMyLocation}
                disabled={locating}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#1F5FA8] hover:underline disabled:opacity-60"
              >
                <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                {locating ? 'Locating...' : t(language, 'useMyLocation')}
              </button>
            </div>
            <input
              id="search-city"
              type="text"
              value={city}
              onChange={(e) => onChangeCity(e.target.value)}
              placeholder="e.g. Nagpur, Dhantoli, Sitabuldi"
              className="w-full h-11 px-3 bg-white border border-[#D1D5DB] rounded text-sm text-[#111827]"
            />
          </div>

          {/* Search Button */}
          <div className="md:col-span-3">
            <button
              type="submit"
              className="w-full h-11 px-4 bg-[#1F5FA8] hover:bg-[#184C87] text-white text-sm font-medium rounded inline-flex items-center justify-center gap-2"
            >
              <Search className="w-4 h-4" aria-hidden="true" />
              {t(language, 'searchButton')}
            </button>
          </div>
        </form>

        {locationNotice && (
          <p className="mt-2 text-xs text-[#4B5563]">{locationNotice}</p>
        )}

        {/* Emergency Safety Notice */}
        <div className="mt-4 pt-3 border-t border-[#E2E6EC] flex flex-wrap items-center justify-between gap-2 text-xs text-[#4B5563]">
          <span>{t(language, 'tagline')}</span>
          <span className="inline-flex items-center gap-1.5 text-[#B91C1C] font-medium">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            {t(language, 'emergencyDisclaimer')}
          </span>
        </div>
      </section>

      {/* Filter, Transport Mode, Sort & Map Toggle Bar */}
      <section className="bg-white border border-[#E2E6EC] rounded-md p-3 sm:p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Transport Mode Toggle */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-[#4B5563]">Travel by:</span>
            <div className="inline-flex border border-[#D1D5DB] rounded overflow-hidden" role="group" aria-label="Transport Mode">
              {([
                { id: 'car', label: 'Car' },
                { id: 'bike', label: 'Bike' },
                { id: 'transit', label: 'Public Transport' },
              ] as Array<{ id: TransportMode; label: string }>).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onChangeTransportMode(m.id)}
                  className={`px-2.5 py-1.5 text-xs font-medium whitespace-nowrap ${
                    transportMode === m.id
                      ? 'bg-[#1F5FA8] text-white'
                      : 'bg-white text-[#374151] hover:bg-[#F5F6F8]'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sort Dropdown */}
          <div className="flex items-center gap-1.5">
            <label htmlFor="sort-select" className="text-xs font-medium text-[#4B5563]">
              Sort:
            </label>
            <select
              id="sort-select"
              value={sortBy}
              onChange={(e) => onChangeSortBy(e.target.value as SortOption)}
              className="h-9 px-2.5 bg-white border border-[#D1D5DB] rounded text-xs font-medium text-[#111827]"
            >
              <option value="least_total_time">Least total time (Default)</option>
              <option value="nearest">Nearest</option>
              <option value="shortest_queue">Shortest queue</option>
              <option value="highest_rated">Highest rated</option>
              <option value="lowest_fee">Lowest fee</option>
            </select>
          </div>

          {/* Open Now Checkbox */}
          <label className="inline-flex items-center gap-1.5 text-xs font-medium text-[#374151] cursor-pointer px-2 py-1">
            <input
              type="checkbox"
              checked={openNowOnly}
              onChange={(e) => onChangeOpenNowOnly(e.target.checked)}
              className="w-4 h-4 accent-[#1F5FA8]"
            />
            {t(language, 'openNow')}
          </label>
        </div>

        {/* List / Map Toggle */}
        <div className="inline-flex border border-[#D1D5DB] rounded overflow-hidden" role="group" aria-label="View Mode">
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${
              viewMode === 'list'
                ? 'bg-[#1F5FA8] text-white'
                : 'bg-white text-[#374151] hover:bg-[#F5F6F8]'
            }`}
          >
            <List className="w-3.5 h-3.5" aria-hidden="true" />
            {t(language, 'listView')}
          </button>
          <button
            type="button"
            onClick={() => setViewMode('map')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${
              viewMode === 'map'
                ? 'bg-[#1F5FA8] text-white'
                : 'bg-white text-[#374151] hover:bg-[#F5F6F8]'
            }`}
          >
            <MapIcon className="w-3.5 h-3.5" aria-hidden="true" />
            {t(language, 'mapView')}
          </button>
        </div>
      </section>

      {/* Error State */}
      {error && (
        <div className="bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C] rounded-md p-4 text-sm">
          {error}
        </div>
      )}

      {/* Loading Skeleton State */}
      {loading && (
        <div className="space-y-3" aria-busy="true" aria-label="Loading OPD results">
          {[1, 2, 3].map((n) => (
            <div key={n} className="bg-white border border-[#E2E6EC] rounded-md p-5 animate-pulse">
              <div className="h-5 bg-[#E5E7EB] rounded w-1/3" />
              <div className="h-4 bg-[#E5E7EB] rounded w-1/2 mt-2" />
              <div className="grid grid-cols-3 gap-3 mt-4">
                <div className="h-16 bg-[#F3F4F6] rounded" />
                <div className="h-16 bg-[#F3F4F6] rounded" />
                <div className="h-16 bg-[#F3F4F6] rounded" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && organic.length === 0 && sponsored.length === 0 && (
        <div className="bg-white border border-[#E2E6EC] rounded-md p-8 text-center">
          <p className="text-base font-semibold text-[#111827]">
            No matching OPDs found in &ldquo;{city || 'selected area'}&rdquo;
          </p>
          <p className="text-sm text-[#4B5563] mt-1">
            Try clearing the &ldquo;Open now&rdquo; filter, selecting &ldquo;All Specialties&rdquo;, or searching &ldquo;Nagpur&rdquo;.
          </p>
          <button
            type="button"
            onClick={() => {
              onChangeCity('Nagpur');
              onChangeSpecialty('Eye OPD');
              onChangeOpenNowOnly(false);
            }}
            className="mt-4 px-4 py-2 text-sm font-medium bg-[#1F5FA8] text-white rounded hover:bg-[#184C87]"
          >
            Reset to Nagpur Eye OPDs
          </button>
        </div>
      )}

      {/* Map View */}
      {!loading && viewMode === 'map' && allMapItems.length > 0 && (
        <HospitalMapView
          items={allMapItems}
          userLocation={userLocation}
          onBook={onBook}
          quotaExceeded={quotaExceeded}
        />
      )}

      {/* List View */}
      {!loading && viewMode === 'list' && (organic.length > 0 || sponsored.length > 0) && (
        <div className="space-y-6">
          {/* Sponsored Section (First 2 results, clearly labeled) */}
          {sponsored.length > 0 && (
            <section aria-label="Sponsored Listings" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">
                  Sponsored Placements ({sponsored.length})
                </h2>
                <p className="text-xs text-[#6B7280]">
                  {t(language, 'sponsoredDisclaimer')}
                </p>
              </div>
              <div className="space-y-3">
                {sponsored.map((item) => (
                  <HospitalCard
                    key={`sp-${item.hospital.id}`}
                    item={item}
                    transportMode={transportMode}
                    language={language}
                    onBook={onBook}
                    nowMs={nowMs}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Organic Results Ranked by Least Total Time + Separate Best Option Banner */}
          {organic.length > 0 && (
            <section aria-label="Organic OPD Results" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-[#111827]">
                  All Matching OPDs ({organic.length}) — Sorted by{' '}
                  {sortBy === 'least_total_time'
                    ? 'Least Total Time'
                    : sortBy === 'nearest'
                      ? 'Nearest Distance'
                      : sortBy === 'shortest_queue'
                        ? 'Shortest Queue'
                        : sortBy === 'highest_rated'
                          ? 'Highest Rating'
                          : 'Lowest Consultation Fee'}
                </h2>
              </div>

              {/* Highlighted Best Option Banner (Always based on Organic Ranking) */}
              {bestOption && (
                <div
                  className="scroll-mt-20 bg-[#EFF6FF] border border-[#BFDBFE] rounded-md p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  data-testid="best-option-banner"
                >
                  <div className="flex items-start gap-2.5">
                    <CheckCircle2 className="w-5 h-5 text-[#1F5FA8] shrink-0 mt-0.5" aria-hidden="true" />
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-[#1F5FA8]">
                        {t(language, 'bestOptionTitle')} · Organic #1
                      </div>
                      <p className="text-sm sm:text-base font-semibold text-[#111827] mt-0.5">
                        {bestOption.hospitalName} ({bestOption.totalTimeMinutes} min total)
                      </p>
                      <p className="text-xs sm:text-sm text-[#374151] mt-0.5">
                        {bestOption.explanation}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const match = organic.find((o) => o.hospital.id === bestOption.hospitalId);
                      if (match) onBook(match);
                    }}
                    className="px-4 py-2 text-sm font-medium bg-[#1F5FA8] text-white rounded hover:bg-[#184C87] whitespace-nowrap shrink-0 min-h-[40px]"
                  >
                    Book Fastest Option
                  </button>
                </div>
              )}

              <div className="space-y-3">
                {organic.map((item) => (
                  <HospitalCard
                    key={`org-${item.hospital.id}`}
                    item={item}
                    transportMode={transportMode}
                    language={language}
                    onBook={onBook}
                    nowMs={nowMs}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
