# Pinnacle — Skip the wait. Reach the right care.

Pinnacle is a mobile-first web application for booking doctor and OPD appointments in India with live queue tracking, live traffic travel estimates, and **Least Total Time** ranking. First launch city: **Nagpur, Maharashtra**.

---

## Folder Structure

- `server.ts` — Express server + Vite middleware on port 3000 (live queue SSE, booking/hospital/admin endpoints, OTP demo verification, and Google Maps/Places proxy routes).
- `src/utils/ranking.ts` — Core queue wait, total time, sponsored slot separation, Best Option savings explanation, and departure advisory algorithms.
- `src/utils/ranking.test.ts` — Deterministic unit tests (`node:test`) for all ranking and queue calculations.
- `src/data/seedHospitals.ts` — Seed dataset of 10 Nagpur Eye OPDs and multi-specialty Nagpur clinics.
- `src/lib/firebase.ts` — Firebase Auth & Firestore client initialization, `testConnection()`, and structured `handleFirestoreError()`.
- `src/components/` — Modular React components (`Navbar`, `HomeSearchView`, `HospitalCard`, `HospitalMapView`, `BookingModal`, `MyAppointmentsView`, `HospitalRegisterView`, `HospitalDashboardView`, `AdminPanelView`, `LoginModal`, `LegalModal`).
- `firebase-blueprint.json` & `firestore.rules` — Firestore schema blueprint and hardened security rules.

---

## Ranking Algorithm (Least Total Time)

1. **Estimated Wait Time**:
   - When a hospital uses the Pinnacle live queue dashboard (`isLiveQueue = true`):
     $$\text{EstimatedWait} = \frac{\text{PatientsWaiting} \times \text{AvgConsultMinutes}}{\max(1, \text{ActiveDoctors})}$$
   - When a hospital has no live queue integration, Pinnacle displays an **Estimated** badge and uses historical averages by time of day.
2. **Wait Remaining at Arrival**:
   - While the patient travels to the hospital, the queue continues moving:
     $$\text{WaitAtArrival} = \max(0, \text{EstimatedWait} - \text{TravelMinutes})$$
3. **Total Time**:
   $$\text{TotalTime} = \text{TravelMinutes} + \text{WaitAtArrival} + \text{AvgConsultMinutes}$$
4. **Best Option for You Banner**:
   - Computed strictly on the **organic** ranking sorted by `TotalTime` (open OPDs first).
   - Displays exact time saved versus the next fastest organic option.

---

## How Sponsored Slots Work (Self-Serve, City & OPD-Specific)

- Up to **2** paid placements exist per **(city, OPD specialty)** pair: **Rank 1** (top position) and **Rank 2** (second position).
- Hospitals select an available slot from the Hospital Dashboard (**Sponsor OPD Slot**) or during registration (Step 6).
- **Live Slot Check**: Displays each rank's price and real-time Firestore availability (`Available` or `Occupied until [time] ([X] min left)`) without exposing the current sponsor's name. If occupied, hospitals can select the other available rank or join the **Waitlist** (notified with a 10-minute claim banner when freed).
- **Automatic Transactional Activation**: Verified payments atomically re-check slot availability and immediately activate `is_sponsored`, `sponsor_rank`, `sponsor_start_date`, and `sponsor_end_date` (`now + SPONSOR_DURATION_MINUTES`) with zero manual approval.
- **Auto-Expiry**: Expired sponsorships are automatically cleared every 30 seconds and on page load, promoting the next waitlisted hospital.
- Each sponsored listing carries a clearly visible **"Sponsored"** label, while the **Best Option for You** banner remains strictly based on organic least total time.

---

## Sponsored Pricing & Payment Modes (`.env`)

Configure pricing, slot duration, and payment mode in environment variables (see `.env.example`):

- `SPONSOR_PRICE_RANK1` — Default `999` (INR)
- `SPONSOR_PRICE_RANK2` — Default `699` (INR)
- `SPONSOR_DURATION_MINUTES` — Default `10080` (7 days). Set `SPONSOR_DURATION_MINUTES=5` for a 5-minute live hackathon demo.
- `RAZORPAY_KEY_ID` & `RAZORPAY_KEY_SECRET` — When both are set (and `DEMO_PAYMENT` is not `true`), Pinnacle runs **Mode A: Razorpay Test Mode** with server-side HMAC-SHA256 verification (`/api/payments/verify`). Never expose `RAZORPAY_KEY_SECRET` to the browser.
- `DEMO_PAYMENT` — Set `DEMO_PAYMENT=true` (or leave Razorpay keys unset) to use **Mode B: Built-in Mock Checkout** (`"Demo payment: no real money is charged"`).

### Test Inputs (Built-in Mock Checkout)

- **UPI Tab**:
  - Success: `success@demo` or `success@razorpay`
  - Failure: `failure@demo` or `failure@razorpay`
- **Card Tab**:
  - Success: Any 16-digit Luhn-valid card number (e.g., `4111 1111 1111 1111`), future `MM/YY` (e.g., `12/29`), 3-digit CVV (e.g., `123`)
  - Simulated Decline: Any Luhn-valid card ending in `0000` (e.g., `4242 4242 4242 0000`) -> shows *"Payment declined, try again"*

---

## Google Cloud & Firebase Setup Guide

1. **Google Cloud APIs to Enable**:
   - **Maps JavaScript API** (browser interactive map & `AdvancedMarkerElement`)
   - **Places API (New)** (ratings, review counts, recent reviews with author attribution)
   - **Routes API** (`computeRouteMatrix` with `TRAFFIC_AWARE` travel times for `DRIVE`, `TWO_WHEELER`, and `TRANSIT`)
2. **Environment Variables** (see `.env.example`):
   - `VITE_GOOGLE_MAPS_API_KEY`: Browser key restricted by HTTP referrers and Maps JavaScript API.
   - `GOOGLE_MAPS_API_KEY`: Server-side key used by `/api/maps/*` proxy routes.
   - `ADMIN_EMAIL`: Verified Google email granted Admin access in `firestore.rules` and Express middleware (defaults to `mayurkorade276@gmail.com`).
   - `OWNER_EMAIL`: Verified Google email granted Hospital Desk access in `firestore.rules` and Express middleware (defaults to `swapnilkorade0203@gmail.com`).
3. **Firebase Configuration**:
   - `firebase-applet-config.json` configures Firebase Auth & Firestore (`firestoreDatabaseId`).
   - Enable **Google** and **Phone** sign-in providers in Firebase Console -> Authentication -> Sign-in method.
4. **Demo / Offline Mode**:
   - Works out-of-the-box without API keys using Nagpur & Pune seed data, realistic traffic estimation, interactive map fallback, built-in mock checkout, and preview OTP (`123456`).

---

## Digital Health Records (PID, Doctor & Medical Workspaces)

- **Health ID (`PID`)**: Every registered patient receives a permanent ID formatted like `PID-4827-1936-05` (the final 2 digits are a weighted check digit) with a scannable QR code on **My Profile**. It is never changed or reused.
- **My Health Records**: Chronological timeline across all hospitals and cities showing diagnoses, prescribed medicines, pharmacy dispensing status (e.g., *"Medicines collected"*), printable A4 black-and-white prescription PDFs, and a **"Who viewed my records"** audit log.
- **Consent & Active-Queue Access**: Doctors can view a patient's cross-hospital medical history **only** while that patient is in their hospital's active queue (`waiting`/`called`) and history sharing is enabled in **My Profile** settings.
- **Strict Queue Rule**: **Hospital Desk** exclusively controls queue positions, token counts, and wait times. **"Patient Left"** and **"Next Patient"** on the **Doctor Workspace** never alter the hospital queue; they only update doctor consultation records and post a notice (`Dr [name] finished with token #[N]`) on the Hospital Desk.
- **Medical Desk**: Hospital-created pharmacy accounts view incoming prescriptions in real time, record item dispensing (`Dispensed`, `Out of stock`, `Substituted`), mark prescriptions **Completed**, and search **Dispensing History** by patient name, PID, or date.

### Role Access & Demo Logins

| Role | Credentials / Access | Notes |
| --- | --- | --- |
| **Patient** | Self-register or sign in via Google / Phone OTP (`123456` in preview) | Generates a permanent Health ID (`PID-XXXX-XXXX-XX`) on registration |
| **Demo Doctor** | `dr.kavita@pinnacle.in` / `Doctor@123` | `Dr. Kavita Nagrale` (`Drishti Point Eye Clinic` — `Eye OPD`) |
| **Demo Medical** | `pharmacy@pinnacle.in` / `Medical@123` | `Suresh Kulkarni` (`Drishti Point Eye Clinic` Pharmacy) |
| **Hospital Desk** | Google Sign-In as `OWNER_EMAIL` (`swapnilkorade0203@gmail.com`) | Exclusive owner access to Hospital Desk, per-OPD queues, walk-ins, and staff creation |
| **Admin** | Google Sign-In as `ADMIN_EMAIL` (`mayurkorade276@gmail.com`) | Exclusive admin access to hospital approvals, sponsored slots, and Reset all data |

---

## Disclaimer

Not for medical emergencies. Call **108 / 112** in an emergency.
