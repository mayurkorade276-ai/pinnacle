import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Award,
  CheckCircle2,
  Clock,
  CreditCard,
  Loader2,
  Smartphone,
  X,
} from 'lucide-react';
import {
  auth,
  commitSponsorshipTransactionToFirestore,
  subscribeToSponsoredSlots,
  syncWaitlistToFirestore,
} from '../lib/firebase';
import type {
  HospitalRecord,
  Specialty,
  SponsoredConfig,
  SponsoredSlotStatus,
  SponsorReceipt,
  SponsorWaitlistEntry,
} from '../types/pinnacle';
import {
  formatDurationLabel,
  formatOccupiedUntil,
  formatShortClock,
  normalizeCardDigits,
  validateCardExpiry,
  validateCvv,
  validateLuhnCard,
  validateUpiId,
} from '../utils/sponsorship';

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, cb: (resp: Record<string, unknown>) => void) => void;
    };
  }
}

interface SponsoredCheckoutModalProps {
  hospital: HospitalRecord;
  initialSpecialty?: Specialty;
  initialRank?: 1 | 2;
  config: SponsoredConfig;
  nowMs: number;
  onClose: () => void;
  onActivated: (receipt: SponsorReceipt) => void;
  onWaitlistJoined: () => void;
}

type ModalStep = 'slot_check' | 'checkout' | 'processing' | 'success' | 'failure' | 'conflict';

async function loadRazorpayScript(): Promise<boolean> {
  if (window.Razorpay) return true;
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(Boolean(window.Razorpay));
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export function SponsoredCheckoutModal({
  hospital,
  initialSpecialty,
  initialRank,
  config: initialConfig,
  nowMs,
  onClose,
  onActivated,
  onWaitlistJoined,
}: SponsoredCheckoutModalProps) {
  const [selectedSpecialty, setSelectedSpecialty] = useState<Specialty>(
    initialSpecialty && hospital.specialties.includes(initialSpecialty)
      ? initialSpecialty
      : hospital.specialties[0] || 'Eye OPD'
  );
  const [config, setConfig] = useState<SponsoredConfig>(initialConfig);
  const [step, setStep] = useState<ModalStep>('slot_check');
  const [selectedRank, setSelectedRank] = useState<1 | 2 | null>(initialRank ?? null);

  // Live slot status from server + Firestore onSnapshot
  const [serverSlots, setServerSlots] = useState<SponsoredSlotStatus[]>([]);
  const [firestoreSlots, setFirestoreSlots] = useState<Partial<Record<1 | 2, SponsoredSlotStatus>>>(
    {}
  );
  const [myWaitlist, setMyWaitlist] = useState<SponsorWaitlistEntry[]>([]);
  const [waitlistNotice, setWaitlistNotice] = useState<string | null>(null);
  const [joiningWaitlistRank, setJoiningWaitlistRank] = useState<1 | 2 | null>(null);

  // Checkout state (Mode B Mock)
  const [mockTab, setMockTab] = useState<'upi' | 'card'>('upi');
  const [upiId, setUpiId] = useState('');
  const [cardHolder, setCardHolder] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Outcome screens
  const [receipt, setReceipt] = useState<SponsorReceipt | null>(null);
  const [failureReason, setFailureReason] = useState<string>('');
  const [conflictMessage, setConflictMessage] = useState<string>('');

  const fetchLiveSlots = useCallback(async () => {
    try {
      const qs = new URLSearchParams({
        city: hospital.city,
        specialty: selectedSpecialty,
        hospitalId: hospital.id,
      });
      const res = await fetch(`/api/sponsored/slots?${qs.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.config) setConfig(data.config);
      if (Array.isArray(data.slots)) setServerSlots(data.slots);
      if (Array.isArray(data.myHospitalWaitlist)) setMyWaitlist(data.myHospitalWaitlist);
    } catch {
      // keep existing live listener state
    }
  }, [hospital.city, hospital.id, selectedSpecialty]);

  // Listen to Firestore onSnapshot + Server SSE + initial fetch
  useEffect(() => {
    void fetchLiveSlots();

    const unsubFirestore = subscribeToSponsoredSlots(
      hospital.city,
      selectedSpecialty,
      (rank, slotStatus) => {
        setFirestoreSlots((prev) => {
          const next = { ...prev };
          if (slotStatus) {
            next[rank] = slotStatus;
          } else {
            delete next[rank];
          }
          return next;
        });
      }
    );

    const sse = new EventSource('/api/stream');
    sse.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data);
        if (parsed.type !== 'connected') {
          void fetchLiveSlots();
        }
      } catch {
        // ignore heartbeat
      }
    };

    return () => {
      unsubFirestore();
      sse.close();
    };
  }, [hospital.city, selectedSpecialty, fetchLiveSlots]);

  const getSlotStatus = (rank: 1 | 2): SponsoredSlotStatus => {
    const fsSlot = firestoreSlots[rank];
    const srvSlot = serverSlots.find((s) => s.rank === rank);
    // Prefer occupied state from whichever source is active & non-expired
    const activeCandidates = [srvSlot, fsSlot].filter((s): s is SponsoredSlotStatus => {
      if (!s || s.status !== 'occupied') return false;
      if (typeof s.occupiedUntilMs === 'number' && s.occupiedUntilMs <= nowMs) return false;
      return true;
    });
    if (activeCandidates.length > 0) {
      return activeCandidates[0];
    }
    return {
      slotKey: `${hospital.city}-${selectedSpecialty}-${rank}`,
      city: hospital.city,
      specialty: selectedSpecialty,
      rank,
      status: 'available',
      updatedAt: nowMs,
    };
  };

  const slot1 = getSlotStatus(1);
  const slot2 = getSlotStatus(2);
  const rank1Occupied = slot1.status === 'occupied';
  const rank2Occupied = slot2.status === 'occupied';
  const bothOccupied = rank1Occupied && rank2Occupied;

  // Auto-adjust selectedRank if current selection becomes occupied
  useEffect(() => {
    if (step !== 'slot_check') return;
    if (selectedRank === 1 && rank1Occupied) {
      setSelectedRank(!rank2Occupied ? 2 : null);
    } else if (selectedRank === 2 && rank2Occupied) {
      setSelectedRank(!rank1Occupied ? 1 : null);
    } else if (selectedRank === null) {
      if (!rank1Occupied) setSelectedRank(1);
      else if (!rank2Occupied) setSelectedRank(2);
    }
  }, [step, selectedRank, rank1Occupied, rank2Occupied]);

  const earliestFreeSlotMs = (() => {
    const times = [slot1.occupiedUntilMs, slot2.occupiedUntilMs].filter(
      (v): v is number => typeof v === 'number' && v > nowMs
    );
    return times.length > 0 ? Math.min(...times) : null;
  })();

  const isOnWaitlist = (rank: 1 | 2) =>
    myWaitlist.some(
      (w) =>
        w.specialty === selectedSpecialty &&
        w.desiredRank === rank &&
        (w.status === 'waiting' || w.status === 'notified')
    );

  const handleJoinWaitlist = async (rank: 1 | 2) => {
    setWaitlistNotice(null);
    setJoiningWaitlistRank(rank);
    try {
      const res = await fetch('/api/sponsored/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hospitalId: hospital.id,
          specialty: selectedSpecialty,
          desiredRank: rank,
          ownerUid: auth.currentUser?.uid || hospital.ownerUid,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setWaitlistNotice(data.error || 'Could not join waitlist.');
        return;
      }
      if (data.entry) {
        await syncWaitlistToFirestore(data.entry);
      }
      await fetchLiveSlots();
      onWaitlistJoined();
      setWaitlistNotice(
        `Added to Rank ${rank} waitlist for ${selectedSpecialty} (${hospital.city}). You will see a dashboard banner when it opens.`
      );
    } catch {
      setWaitlistNotice('Network error while joining waitlist.');
    } finally {
      setJoiningWaitlistRank(null);
    }
  };

  const getAuthHeaders = async (): Promise<Record<string, string>> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth.currentUser) {
      try {
        const token = await auth.currentUser.getIdToken();
        headers.Authorization = `Bearer ${token}`;
      } catch {
        // optional
      }
    }
    return headers;
  };

  const handleStartPayment = async () => {
    if (!selectedRank) return;
    if ((selectedRank === 1 && rank1Occupied) || (selectedRank === 2 && rank2Occupied)) {
      return;
    }

    if (config.paymentMode === 'mock') {
      setFormErrors({});
      setStep('checkout');
      return;
    }

    // MODE A: Razorpay Test Mode
    setStep('processing');
    try {
      const headers = await getAuthHeaders();
      const orderRes = await fetch('/api/payments/create-order', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          hospitalId: hospital.id,
          specialty: selectedSpecialty,
          rank: selectedRank,
        }),
      });
      const orderData = await orderRes.json();
      if (orderRes.status === 409) {
        setConflictMessage('This slot was just taken. No amount was charged');
        setStep('conflict');
        void fetchLiveSlots();
        return;
      }
      if (!orderRes.ok) {
        setFailureReason(orderData.error || 'Could not create Razorpay order.');
        setStep('failure');
        return;
      }

      const loaded = await loadRazorpayScript();
      if (!loaded || !window.Razorpay) {
        setFailureReason('Could not load Razorpay Checkout script.');
        setStep('failure');
        return;
      }

      const rzp = new window.Razorpay({
        key: orderData.keyId,
        amount: orderData.amountPaise,
        currency: orderData.currency || 'INR',
        name: 'Pinnacle',
        description: `Sponsored Rank #${selectedRank} · ${selectedSpecialty} (${hospital.city})`,
        order_id: orderData.orderId,
        handler: async (response: Record<string, unknown>) => {
          setStep('processing');
          try {
            const verifyHeaders = await getAuthHeaders();
            const verifyRes = await fetch('/api/payments/verify', {
              method: 'POST',
              headers: verifyHeaders,
              body: JSON.stringify({
                orderId: String(response.razorpay_order_id || orderData.orderId),
                paymentId: String(response.razorpay_payment_id || ''),
                signature: String(response.razorpay_signature || ''),
                ownerUid: auth.currentUser?.uid || hospital.ownerUid,
              }),
            });
            const verifyData = await verifyRes.json();
            if (verifyRes.status === 409 || verifyData.conflict) {
              setConflictMessage(verifyData.message || 'This slot was just taken. No amount was charged');
              setStep('conflict');
              void fetchLiveSlots();
              return;
            }
            if (!verifyRes.ok || !verifyData.verified || !verifyData.activated) {
              setFailureReason(verifyData.error || 'Payment verification failed.');
              setStep('failure');
              return;
            }
            if (verifyData.receipt) {
              await commitSponsorshipTransactionToFirestore({
                hospitalId: hospital.id,
                hospitalName: hospital.name,
                city: hospital.city,
                specialty: selectedSpecialty,
                rank: selectedRank,
                orderId: verifyData.receipt.orderId,
                paymentId: verifyData.receipt.paymentId,
                amount: verifyData.receipt.amount,
                mode: 'razorpay',
                startIso: verifyData.receipt.startIso,
                endIso: verifyData.receipt.endIso,
                endMs: Date.parse(verifyData.receipt.endIso),
              });
              setReceipt(verifyData.receipt);
              setStep('success');
              onActivated(verifyData.receipt);
            }
          } catch {
            setFailureReason('Network error during server-side signature verification.');
            setStep('failure');
          }
        },
        modal: {
          ondismiss: () => {
            setFailureReason('Razorpay checkout was cancelled before payment completed.');
            setStep('failure');
          },
        },
        theme: { color: '#1F5FA8' },
      });

      rzp.on('payment.failed', (resp: Record<string, unknown>) => {
        const err = (resp.error as Record<string, unknown>) || {};
        setFailureReason(String(err.description || 'Razorpay payment failed.'));
        setStep('failure');
      });

      rzp.open();
    } catch {
      setFailureReason('Unable to launch Razorpay Checkout.');
      setStep('failure');
    }
  };

  const validateMockForm = (): boolean => {
    const errors: Record<string, string> = {};
    if (mockTab === 'upi') {
      if (!validateUpiId(upiId)) {
        errors.upiId = 'Enter a valid UPI ID (e.g. success@demo or failure@demo).';
      }
    } else {
      if (cardHolder.trim().length < 2) {
        errors.cardHolder = 'Enter cardholder name.';
      }
      const digits = normalizeCardDigits(cardNumber);
      if (digits.length !== 16 || !validateLuhnCard(digits)) {
        errors.cardNumber = 'Enter a valid 16-digit card number (Luhn check failed).';
      }
      if (!validateCardExpiry(cardExpiry)) {
        errors.cardExpiry = 'Enter a valid future expiry in MM/YY format.';
      }
      if (!validateCvv(cardCvv)) {
        errors.cardCvv = 'Enter a valid 3-digit CVV.';
      }
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmitMockCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRank || !validateMockForm()) return;

    setStep('processing');
    try {
      const headers = await getAuthHeaders();
      const orderRes = await fetch('/api/payments/create-order', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          hospitalId: hospital.id,
          specialty: selectedSpecialty,
          rank: selectedRank,
        }),
      });
      const orderData = await orderRes.json();
      if (orderRes.status === 409) {
        setConflictMessage('This slot was just taken. No amount was charged');
        setStep('conflict');
        void fetchLiveSlots();
        return;
      }
      if (!orderRes.ok) {
        setFailureReason(orderData.error || 'Could not initialize demo order.');
        setStep('failure');
        return;
      }

      // Realistic 2-second processing screen before verification & activation
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const verifyHeaders = await getAuthHeaders();
      const verifyRes = await fetch('/api/payments/verify', {
        method: 'POST',
        headers: verifyHeaders,
        body: JSON.stringify({
          orderId: orderData.orderId,
          orderChallenge: orderData.orderChallenge,
          mockMethod: mockTab,
          upiId: upiId.trim(),
          cardNumber,
          cardExpiry,
          cardCvv,
          cardHolder,
          ownerUid: auth.currentUser?.uid || hospital.ownerUid,
        }),
      });
      const verifyData = await verifyRes.json();

      if (verifyRes.status === 409 || verifyData.conflict) {
        setConflictMessage(verifyData.message || 'This slot was just taken. No amount was charged');
        setStep('conflict');
        void fetchLiveSlots();
        return;
      }

      if (!verifyRes.ok || !verifyData.verified || !verifyData.activated) {
        setFailureReason(verifyData.error || 'Payment failed.');
        setStep('failure');
        return;
      }

      if (verifyData.receipt) {
        await commitSponsorshipTransactionToFirestore({
          hospitalId: hospital.id,
          hospitalName: hospital.name,
          city: hospital.city,
          specialty: selectedSpecialty,
          rank: selectedRank,
          orderId: verifyData.receipt.orderId,
          paymentId: verifyData.receipt.paymentId,
          amount: verifyData.receipt.amount,
          mode: 'mock',
          startIso: verifyData.receipt.startIso,
          endIso: verifyData.receipt.endIso,
          endMs: Date.parse(verifyData.receipt.endIso),
        });
        setReceipt(verifyData.receipt);
        setStep('success');
        onActivated(verifyData.receipt);
      }
    } catch {
      setFailureReason('Network error while verifying demo payment.');
      setStep('failure');
    }
  };

  const selectedPrice =
    selectedRank === 1 ? config.priceRank1 : selectedRank === 2 ? config.priceRank2 : 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Sponsored Slot Checkout"
    >
      <div className="bg-white border border-[#E2E6EC] rounded-md w-full max-w-xl my-auto">
        {/* Header */}
        <div className="px-4 sm:px-5 py-3.5 border-b border-[#E2E6EC] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Award className="w-4 h-4 text-[#1F5FA8]" aria-hidden="true" />
            <div>
              <h2 className="text-sm sm:text-base font-bold text-[#111827]">
                Sponsor OPD Placement — {hospital.name}
              </h2>
              <p className="text-xs text-[#6B7280]">
                {hospital.city} · Instant activation after payment verification (no manual approval)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 text-[#6B7280] hover:text-[#111827] rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 sm:p-5">
          {/* STEP 1: LIVE SLOT CHECK BEFORE PAYMENT */}
          {step === 'slot_check' && (
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="sponsor-modal-specialty"
                  className="block text-xs font-medium text-[#374151] mb-1"
                >
                  Select OPD Specialty ({hospital.city})
                </label>
                <select
                  id="sponsor-modal-specialty"
                  value={selectedSpecialty}
                  onChange={(e) => {
                    setSelectedSpecialty(e.target.value as Specialty);
                    setWaitlistNotice(null);
                  }}
                  className="w-full h-10 px-3 bg-white border border-[#D1D5DB] rounded text-sm text-[#111827]"
                >
                  {hospital.specialties.map((sp) => (
                    <option key={sp} value={sp}>
                      {sp}
                    </option>
                  ))}
                </select>
              </div>

              {/* Dynamic notice when Rank 1 occupied or both occupied */}
              {bothOccupied ? (
                <div className="p-3.5 bg-[#FEF2F2] border border-[#FECACA] rounded text-xs space-y-1">
                  <div className="font-semibold text-[#B91C1C]">
                    Both sponsored slots are currently occupied
                  </div>
                  {earliestFreeSlotMs && (
                    <p className="text-[#7F1D1D]">
                      Earliest slot frees up at {formatShortClock(earliestFreeSlotMs)} (
                      {formatOccupiedUntil(earliestFreeSlotMs, nowMs).replace('Occupied until ', '')}).
                    </p>
                  )}
                  <p className="text-[#4B5563]">
                    Join the waitlist below to get a 10-minute claim alert banner as soon as a slot opens.
                  </p>
                </div>
              ) : rank1Occupied ? (
                <div className="p-3 bg-[#FFFBEB] border border-[#FDE68A] rounded text-xs text-[#92400E]">
                  Rank 1 is currently occupied. You can choose Rank 2, or join the waitlist for Rank 1.
                </div>
              ) : null}

              {waitlistNotice && (
                <div className="p-3 bg-[#EFF6FF] border border-[#BFDBFE] rounded text-xs text-[#1F5FA8] font-medium">
                  {waitlistNotice}
                </div>
              )}

              {/* Rank 1 & Rank 2 Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {([
                  {
                    rank: 1 as const,
                    slot: slot1,
                    price: config.priceRank1,
                    title: 'Rank 1 (Top Position)',
                    occupied: rank1Occupied,
                  },
                  {
                    rank: 2 as const,
                    slot: slot2,
                    price: config.priceRank2,
                    title: 'Rank 2 (Second Position)',
                    occupied: rank2Occupied,
                  },
                ]).map(({ rank, slot, price, title, occupied }) => {
                  const isSelected = selectedRank === rank && !occupied;
                  const waiting = isOnWaitlist(rank);
                  return (
                    <div
                      key={rank}
                      data-testid={`sponsor-slot-card-${rank}`}
                      className={`border rounded-md p-3.5 flex flex-col justify-between gap-3 ${
                        isSelected
                          ? 'border-[#1F5FA8] bg-[#EFF6FF]'
                          : occupied
                            ? 'border-[#E2E6EC] bg-[#F9FAFB]'
                            : 'border-[#D1D5DB] bg-white'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-[#111827]">{title}</span>
                          <span
                            className={`text-[11px] font-medium px-2 py-0.5 rounded border ${
                              occupied
                                ? 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
                                : 'bg-[#ECFDF5] border-[#BBF7D0] text-[#15803D]'
                            }`}
                          >
                            {occupied ? 'Occupied' : 'Available'}
                          </span>
                        </div>

                        <div className="mt-2 flex items-baseline gap-1.5">
                          <span className="text-xl font-bold text-[#1F5FA8] tabular-nums">
                            ₹{price}
                          </span>
                          <span className="text-xs text-[#6B7280]">
                            / {formatDurationLabel(config.durationMinutes)}
                          </span>
                        </div>

                        <div className="mt-2 text-xs text-[#4B5563] flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 shrink-0 text-[#6B7280]" aria-hidden="true" />
                          <span>
                            {occupied && slot.occupiedUntilMs
                              ? formatOccupiedUntil(slot.occupiedUntilMs, nowMs)
                              : occupied
                                ? 'Occupied right now'
                                : 'Available now for instant activation'}
                          </span>
                        </div>
                      </div>

                      <div>
                        {occupied ? (
                          <div className="space-y-2">
                            <button
                              type="button"
                              disabled
                              aria-disabled="true"
                              className="w-full py-2 text-xs font-medium bg-[#E5E7EB] text-[#6B7280] rounded cursor-not-allowed"
                            >
                              Select Rank {rank} (Disabled)
                            </button>
                            <button
                              type="button"
                              disabled={waiting || joiningWaitlistRank !== null}
                              onClick={() => void handleJoinWaitlist(rank)}
                              data-testid={`join-waitlist-rank-${rank}`}
                              className="w-full py-2 text-xs font-semibold border border-[#1F5FA8] text-[#1F5FA8] bg-white rounded hover:bg-[#EFF6FF] disabled:opacity-60"
                            >
                              {waiting
                                ? `On Rank ${rank} Waitlist`
                                : joiningWaitlistRank === rank
                                  ? 'Joining...'
                                  : `Join waitlist`}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setSelectedRank(rank)}
                            data-testid={`select-slot-rank-${rank}`}
                            className={`w-full py-2 text-xs font-semibold rounded border ${
                              isSelected
                                ? 'bg-[#1F5FA8] text-white border-[#1F5FA8]'
                                : 'bg-white text-[#1F5FA8] border-[#1F5FA8] hover:bg-[#EFF6FF]'
                            }`}
                          >
                            {isSelected ? `Selected Rank ${rank}` : `Select Rank ${rank}`}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="pt-3 border-t border-[#E2E6EC] flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-medium border border-[#D1D5DB] rounded text-[#374151] hover:bg-[#F5F6F8] min-h-[38px]"
                >
                  Cancel
                </button>
                {!bothOccupied && (
                  <button
                    type="button"
                    disabled={!selectedRank}
                    onClick={() => void handleStartPayment()}
                    data-testid="proceed-to-payment-btn"
                    className="px-4 py-2 text-xs sm:text-sm font-semibold bg-[#1F5FA8] text-white rounded hover:bg-[#184C87] disabled:opacity-50 min-h-[40px]"
                  >
                    {selectedRank
                      ? `Pay ₹${selectedPrice} & Activate Rank ${selectedRank}`
                      : 'Select an Available Slot'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* STEP 2: MODE B MOCK CHECKOUT */}
          {step === 'checkout' && selectedRank && (
            <form onSubmit={handleSubmitMockCheckout} className="space-y-4">
              <div className="p-3 bg-[#F9FAFB] border border-[#E2E6EC] rounded flex items-center justify-between text-xs">
                <div>
                  <div className="font-semibold text-[#111827]">
                    Sponsored Rank #{selectedRank} · {selectedSpecialty} ({hospital.city})
                  </div>
                  <div className="text-[#6B7280]">
                    Validity: {formatDurationLabel(config.durationMinutes)}
                  </div>
                </div>
                <div className="text-base font-bold text-[#1F5FA8] tabular-nums">
                  ₹{selectedPrice}
                </div>
              </div>

              <div className="px-3 py-2 bg-[#EFF6FF] border border-[#BFDBFE] rounded text-xs font-medium text-[#1F5FA8]">
                Demo payment: no real money is charged
              </div>

              {/* Payment Method Tabs */}
              <div className="grid grid-cols-2 border border-[#D1D5DB] rounded overflow-hidden">
                <button
                  type="button"
                  onClick={() => {
                    setMockTab('upi');
                    setFormErrors({});
                  }}
                  className={`py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 ${
                    mockTab === 'upi'
                      ? 'bg-[#1F5FA8] text-white'
                      : 'bg-white text-[#374151] hover:bg-[#F5F6F8]'
                  }`}
                >
                  <Smartphone className="w-3.5 h-3.5" aria-hidden="true" />
                  UPI
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMockTab('card');
                    setFormErrors({});
                  }}
                  className={`py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 ${
                    mockTab === 'card'
                      ? 'bg-[#1F5FA8] text-white'
                      : 'bg-white text-[#374151] hover:bg-[#F5F6F8]'
                  }`}
                >
                  <CreditCard className="w-3.5 h-3.5" aria-hidden="true" />
                  Card
                </button>
              </div>

              {mockTab === 'upi' ? (
                <div className="space-y-2">
                  <label htmlFor="mock-upi-input" className="block text-xs font-medium text-[#374151]">
                    UPI ID *
                  </label>
                  <input
                    id="mock-upi-input"
                    type="text"
                    value={upiId}
                    onChange={(e) => setUpiId(e.target.value)}
                    placeholder="success@demo or failure@demo"
                    className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm bg-white"
                  />
                  {formErrors.upiId && (
                    <p className="text-xs text-[#B91C1C]">{formErrors.upiId}</p>
                  )}
                  <p className="text-[11px] text-[#6B7280]">
                    Test inputs: <code>success@demo</code> (or <code>success@razorpay</code>) for success ·{' '}
                    <code>failure@demo</code> for failure.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label htmlFor="mock-card-holder" className="block text-xs font-medium text-[#374151] mb-1">
                      Cardholder Name *
                    </label>
                    <input
                      id="mock-card-holder"
                      type="text"
                      value={cardHolder}
                      onChange={(e) => setCardHolder(e.target.value)}
                      placeholder="Dr. Ashwini Deshpande"
                      className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm bg-white"
                    />
                    {formErrors.cardHolder && (
                      <p className="text-xs text-[#B91C1C] mt-1">{formErrors.cardHolder}</p>
                    )}
                  </div>
                  <div>
                    <label htmlFor="mock-card-number" className="block text-xs font-medium text-[#374151] mb-1">
                      16-Digit Card Number *
                    </label>
                    <input
                      id="mock-card-number"
                      type="text"
                      inputMode="numeric"
                      maxLength={19}
                      value={cardNumber}
                      onChange={(e) => {
                        const digits = normalizeCardDigits(e.target.value).slice(0, 16);
                        const grouped = digits.replace(/(.{4})/g, '$1 ').trim();
                        setCardNumber(grouped);
                      }}
                      placeholder="4111 1111 1111 1111"
                      className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm bg-white tabular-nums"
                    />
                    {formErrors.cardNumber && (
                      <p className="text-xs text-[#B91C1C] mt-1">{formErrors.cardNumber}</p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="mock-card-expiry" className="block text-xs font-medium text-[#374151] mb-1">
                        Expiry (MM/YY) *
                      </label>
                      <input
                        id="mock-card-expiry"
                        type="text"
                        maxLength={5}
                        value={cardExpiry}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/[^\d/]/g, '').slice(0, 5);
                          setCardExpiry(raw);
                        }}
                        placeholder="12/29"
                        className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm bg-white tabular-nums"
                      />
                      {formErrors.cardExpiry && (
                        <p className="text-xs text-[#B91C1C] mt-1">{formErrors.cardExpiry}</p>
                      )}
                    </div>
                    <div>
                      <label htmlFor="mock-card-cvv" className="block text-xs font-medium text-[#374151] mb-1">
                        CVV *
                      </label>
                      <input
                        id="mock-card-cvv"
                        type="password"
                        inputMode="numeric"
                        maxLength={3}
                        value={cardCvv}
                        onChange={(e) => setCardCvv(e.target.value.replace(/\D/g, '').slice(0, 3))}
                        placeholder="123"
                        className="w-full h-10 px-3 border border-[#D1D5DB] rounded text-sm bg-white tabular-nums"
                      />
                      {formErrors.cardCvv && (
                        <p className="text-xs text-[#B91C1C] mt-1">{formErrors.cardCvv}</p>
                      )}
                    </div>
                  </div>
                  <p className="text-[11px] text-[#6B7280]">
                    Any Luhn-valid card succeeds; ending in <code>0000</code> (e.g. <code>4242 4242 4242 0000</code>) simulates a decline.
                  </p>
                </div>
              )}

              <div className="pt-3 border-t border-[#E2E6EC] flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setStep('slot_check')}
                  className="px-4 py-2 text-xs font-medium border border-[#D1D5DB] rounded text-[#374151] hover:bg-[#F5F6F8] min-h-[38px]"
                >
                  Back to Slots
                </button>
                <button
                  type="submit"
                  data-testid="mock-pay-submit-btn"
                  className="px-5 py-2 text-xs sm:text-sm font-semibold bg-[#1F5FA8] text-white rounded hover:bg-[#184C87] min-h-[40px]"
                >
                  Pay ₹{selectedPrice}
                </button>
              </div>
            </form>
          )}

          {/* PROCESSING SCREEN (2 seconds) */}
          {step === 'processing' && (
            <div className="py-10 text-center space-y-3" data-testid="payment-processing">
              <Loader2 className="w-8 h-8 text-[#1F5FA8] animate-spin mx-auto" aria-hidden="true" />
              <div className="text-sm font-semibold text-[#111827]">Processing payment...</div>
              <p className="text-xs text-[#6B7280]">
                Verifying payment signature and locking Rank #{selectedRank} in Firestore...
              </p>
            </div>
          )}

          {/* SUCCESS RECEIPT SCREEN */}
          {step === 'success' && receipt && (
            <div className="space-y-4" data-testid="payment-success-receipt">
              <div className="p-3.5 bg-[#ECFDF5] border border-[#BBF7D0] rounded flex items-start gap-2.5">
                <CheckCircle2 className="w-5 h-5 text-[#15803D] shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <div className="text-sm font-semibold text-[#15803D]">
                    Payment Verified &amp; Sponsored Placement Active
                  </div>
                  <p className="text-xs text-[#166534] mt-0.5">
                    Your hospital is now live at Sponsored Rank #{receipt.rank} for{' '}
                    {receipt.specialty} in {receipt.city}.
                  </p>
                </div>
              </div>

              <div className="border border-[#E2E6EC] rounded p-3.5 bg-[#F9FAFB] text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-[#6B7280]">Hospital</span>
                  <span className="font-semibold text-[#111827]">{receipt.hospitalName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#6B7280]">Placement</span>
                  <span className="font-semibold text-[#1F5FA8]">
                    Rank #{receipt.rank} · {receipt.specialty} ({receipt.city})
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#6B7280]">Order ID</span>
                  <span className="font-mono text-[#111827]">{receipt.orderId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#6B7280]">Amount Paid</span>
                  <span className="font-semibold text-[#111827] tabular-nums">
                    ₹{receipt.amount}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#6B7280]">Validity Period</span>
                  <span className="font-medium text-[#111827] tabular-nums">
                    {formatShortClock(Date.parse(receipt.startIso))} –{' '}
                    {formatShortClock(Date.parse(receipt.endIso))} (
                    {formatDurationLabel(receipt.durationMinutes)})
                  </span>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2 text-xs sm:text-sm font-semibold bg-[#1F5FA8] text-white rounded hover:bg-[#184C87] min-h-[40px]"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {/* FAILURE SCREEN */}
          {step === 'failure' && (
            <div className="space-y-4" data-testid="payment-failure-screen">
              <div className="p-3.5 bg-[#FEF2F2] border border-[#FECACA] rounded flex items-start gap-2.5">
                <AlertCircle className="w-5 h-5 text-[#B91C1C] shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <div className="text-sm font-semibold text-[#B91C1C]">Payment Failed</div>
                  <p className="text-xs text-[#7F1D1D] mt-0.5">{failureReason}</p>
                  <p className="text-[11px] text-[#6B7280] mt-1">
                    Sponsorship was not activated.
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-medium border border-[#D1D5DB] rounded text-[#374151] hover:bg-[#F5F6F8] min-h-[38px]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setStep(config.paymentMode === 'mock' ? 'checkout' : 'slot_check')
                  }
                  className="px-5 py-2 text-xs sm:text-sm font-semibold bg-[#1F5FA8] text-white rounded hover:bg-[#184C87] min-h-[40px]"
                >
                  Try again
                </button>
              </div>
            </div>
          )}

          {/* SLOT CONFLICT SCREEN */}
          {step === 'conflict' && (
            <div className="space-y-4" data-testid="payment-conflict-screen">
              <div className="p-3.5 bg-[#FFFBEB] border border-[#FDE68A] rounded flex items-start gap-2.5">
                <AlertCircle className="w-5 h-5 text-[#B45309] shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <div className="text-sm font-semibold text-[#92400E]">
                    {conflictMessage || 'This slot was just taken. No amount was charged'}
                  </div>
                  <p className="text-xs text-[#78350F] mt-0.5">
                    You can select the other available slot or join the waitlist below.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2">
                {selectedRank && (
                  <button
                    type="button"
                    onClick={async () => {
                      await handleJoinWaitlist(selectedRank);
                      setStep('slot_check');
                    }}
                    className="px-4 py-2 text-xs font-semibold border border-[#1F5FA8] text-[#1F5FA8] rounded hover:bg-[#EFF6FF] min-h-[38px]"
                  >
                    Join Waitlist for Rank {selectedRank}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRank(null);
                    setStep('slot_check');
                  }}
                  className="px-4 py-2 text-xs font-semibold bg-[#1F5FA8] text-white rounded hover:bg-[#184C87] min-h-[38px]"
                >
                  Check Available Slots
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
