import { useState } from 'react';
import {
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  useAdvancedMarkerRef,
} from '@vis.gl/react-google-maps';
import type { Coordinates, RankedHospital } from '../types/pinnacle';

interface HospitalMapViewProps {
  items: RankedHospital[];
  userLocation: Coordinates;
  onBook: (item: RankedHospital) => void;
  quotaExceeded: boolean;
}

function getPinColors(level: 'green' | 'amber' | 'red') {
  if (level === 'green') {
    return { bg: '#15803D', border: '#14532D', glyph: '#FFFFFF' };
  }
  if (level === 'amber') {
    return { bg: '#D97706', border: '#92400E', glyph: '#FFFFFF' };
  }
  return { bg: '#DC2626', border: '#991B1B', glyph: '#FFFFFF' };
}

function GoogleHospitalMarker({
  item,
  isSelected,
  onSelect,
  onClose,
  onBook,
}: {
  item: RankedHospital;
  isSelected: boolean;
  onSelect: () => void;
  onClose: () => void;
  onBook: (item: RankedHospital) => void;
}) {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const colors = getPinColors(item.queueLevel);

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={{ lat: item.hospital.lat, lng: item.hospital.lng }}
        title={`${item.hospital.name} (${item.totalTimeMinutes} min total)`}
        onClick={onSelect}
      >
        <div
          style={{ backgroundColor: colors.bg, borderColor: colors.border }}
          className="px-2 py-1 rounded text-white text-xs font-bold border-2 shadow-sm tabular-nums whitespace-nowrap"
        >
          {item.totalTimeMinutes}m
        </div>
      </AdvancedMarker>
      {isSelected && marker && (
        <InfoWindow anchor={marker} onCloseClick={onClose} maxWidth={260}>
          <div className="p-1 text-[#111827]">
            <p className="font-semibold text-sm">{item.hospital.name}</p>
            <p className="text-xs text-[#4B5563] mt-0.5">{item.hospital.area}</p>
            <p className="text-xs mt-1 tabular-nums">
              <strong>{item.totalTimeMinutes} min total</strong> ({item.travelMinutes}m travel + {item.estimatedWaitMinutes}m queue)
            </p>
            <button
              type="button"
              onClick={() => onBook(item)}
              className="mt-2 w-full py-1.5 px-3 bg-[#1F5FA8] text-white text-xs font-medium rounded hover:bg-[#184C87]"
            >
              Book Appointment
            </button>
          </div>
        </InfoWindow>
      )}
    </>
  );
}

/**
 * Clean coordinate map fallback when browser Google Maps JS key is unset or quota-exhausted.
 * Plots Nagpur bounds accurately so pin colors, selection, and queue inspection always work.
 */
function NagpurCoordinateMapFallback({
  items,
  userLocation,
  onBook,
}: {
  items: RankedHospital[];
  userLocation: Coordinates;
  onBook: (item: RankedHospital) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.hospital.id ?? null);

  // Compute bounding box around Nagpur + listed hospitals
  const lats = [...items.map((i) => i.hospital.lat), userLocation.lat];
  const lngs = [...items.map((i) => i.hospital.lng), userLocation.lng];
  const minLat = Math.min(...lats) - 0.015;
  const maxLat = Math.max(...lats) + 0.015;
  const minLng = Math.min(...lngs) - 0.015;
  const maxLng = Math.max(...lngs) + 0.015;

  const toPercent = (lat: number, lng: number) => {
    const x = ((lng - minLng) / Math.max(0.01, maxLng - minLng)) * 84 + 8;
    const y = ((maxLat - lat) / Math.max(0.01, maxLat - minLat)) * 78 + 10;
    return { left: `${x}%`, top: `${y}%` };
  };

  const selectedItem = items.find((i) => i.hospital.id === selectedId) ?? items[0] ?? null;
  const userPos = toPercent(userLocation.lat, userLocation.lng);

  return (
    <div className="bg-white border border-[#E2E6EC] rounded-md overflow-hidden">
      <div className="px-4 py-2.5 bg-[#F9FAFB] border-b border-[#E2E6EC] flex flex-wrap items-center justify-between gap-2 text-xs text-[#4B5563]">
        <span>Nagpur OPD Queue Map (Interactive Demo View)</span>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-[#15803D]" /> ≤15m wait
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-[#D97706]" /> 16–30m wait
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-[#DC2626]" /> &gt;30m / Paused / Closed
          </span>
        </div>
      </div>

      <div className="relative w-full h-[420px] bg-[#EEF2F6] overflow-hidden">
        {/* Subtle Nagpur road grid lines */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
          <line x1="0" y1="50%" x2="100%" y2="48%" stroke="#CBD5E1" strokeWidth="2" />
          <line x1="48%" y1="0" x2="52%" y2="100%" stroke="#CBD5E1" strokeWidth="2" />
          <line x1="15%" y1="20%" x2="85%" y2="82%" stroke="#DCE3EC" strokeWidth="1.5" />
          <line x1="20%" y1="85%" x2="80%" y2="18%" stroke="#DCE3EC" strokeWidth="1.5" />
        </svg>

        {/* User Location Marker */}
        <div
          style={userPos}
          className="absolute -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none"
          title="Your location"
        >
          <div className="w-4 h-4 rounded-full bg-[#1F5FA8] border-2 border-white shadow" />
          <span className="block text-[10px] font-semibold text-[#1F5FA8] bg-white px-1 rounded border border-[#E2E6EC] mt-0.5 whitespace-nowrap">
            You
          </span>
        </div>

        {/* Hospital Pins */}
        {items.map((item) => {
          const pos = toPercent(item.hospital.lat, item.hospital.lng);
          const colors = getPinColors(item.queueLevel);
          const isSelected = selectedItem?.hospital.id === item.hospital.id;
          return (
            <button
              key={item.hospital.id}
              type="button"
              style={{ ...pos, backgroundColor: colors.bg, borderColor: colors.border }}
              onClick={() => setSelectedId(item.hospital.id)}
              className={`absolute -translate-x-1/2 -translate-y-1/2 z-20 px-2 py-1 rounded text-white text-xs font-semibold border-2 tabular-nums transition-transform ${
                isSelected ? 'scale-110 ring-2 ring-[#1F5FA8]' : 'hover:scale-105'
              }`}
              aria-label={`${item.hospital.name}, ${item.totalTimeMinutes} minutes total time`}
            >
              {item.totalTimeMinutes}m
            </button>
          );
        })}

        {/* Selected Hospital Summary Card */}
        {selectedItem && (
          <div className="absolute bottom-3 left-3 right-3 sm:left-auto sm:right-3 sm:w-80 bg-white border border-[#D1D5DB] rounded p-3 z-30 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-[#111827]">
                  {selectedItem.hospital.name}
                </p>
                <p className="text-xs text-[#6B7280]">{selectedItem.hospital.address}</p>
              </div>
              <span className="text-sm font-bold text-[#1F5FA8] tabular-nums shrink-0">
                {selectedItem.totalTimeMinutes}m
              </span>
            </div>
            <p className="text-xs text-[#374151] mt-2 tabular-nums">
              {selectedItem.hospital.patientsWaiting} waiting · ~{selectedItem.estimatedWaitMinutes}m wait · {selectedItem.travelMinutes}m travel · ₹{selectedItem.hospital.consultationFee}
            </p>
            <button
              type="button"
              onClick={() => onBook(selectedItem)}
              className="mt-2.5 w-full py-2 px-3 bg-[#1F5FA8] text-white text-xs font-medium rounded hover:bg-[#184C87] min-h-[38px]"
            >
              Book Appointment
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function HospitalMapView({
  items,
  userLocation,
  onBook,
  quotaExceeded,
}: HospitalMapViewProps) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  const [selectedHospitalId, setSelectedHospitalId] = useState<string | null>(null);

  if (!apiKey || quotaExceeded) {
    return (
      <NagpurCoordinateMapFallback
        items={items}
        userLocation={userLocation}
        onBook={onBook}
      />
    );
  }

  return (
    <div className="bg-white border border-[#E2E6EC] rounded-md overflow-hidden">
      <div className="px-4 py-2.5 bg-[#F9FAFB] border-b border-[#E2E6EC] flex flex-wrap items-center justify-between gap-2 text-xs text-[#4B5563]">
        <span>Google Maps Live OPD Queue View</span>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-[#15803D]" /> ≤15m wait
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-[#D97706]" /> 16–30m wait
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-[#DC2626]" /> &gt;30m / Paused / Closed
          </span>
        </div>
      </div>

      <div style={{ width: '100%', height: '440px' }} data-testid="hospital-map-container">
        <APIProvider apiKey={apiKey} libraries={['marker']} language="en" region="IN">
          <GoogleMap
            mapId="DEMO_MAP_ID"
            defaultCenter={userLocation}
            defaultZoom={12}
            gestureHandling="greedy"
            internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
            style={{ width: '100%', height: '100%' }}
          >
            <AdvancedMarker position={userLocation} title="Your location">
              <div className="flex flex-col items-center">
                <div className="w-4 h-4 rounded-full bg-[#1F5FA8] border-2 border-white shadow" />
                <span className="text-[10px] font-semibold text-[#1F5FA8] bg-white px-1 rounded border border-[#E2E6EC] mt-0.5">
                  You
                </span>
              </div>
            </AdvancedMarker>
            {items.map((item) => (
              <GoogleHospitalMarker
                key={item.hospital.id}
                item={item}
                isSelected={selectedHospitalId === item.hospital.id}
                onSelect={() => setSelectedHospitalId(item.hospital.id)}
                onClose={() => setSelectedHospitalId(null)}
                onBook={onBook}
              />
            ))}
          </GoogleMap>
        </APIProvider>
      </div>
    </div>
  );
}
