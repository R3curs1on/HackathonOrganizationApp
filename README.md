# HackathonOrganizationApp

Expo + Node/Mongo app for hackathon operations: QR-based registration, live team dashboard, and team evaluations.

## Stack
- Frontend: Expo React Native
- Backend: Express + Mongoose
- Database: MongoDB
- Data scripts: Python (`pymongo`)

## Key Updates
- Default `lab_no` is now `1000` (model + import fallback).
- Register action always marks participant present/registered and returns lab number.
- Results and evaluation endpoints are passphrase-protected.
- Evaluation model simplified to 3 columns:
  - `evaluation_1`
  - `evaluation_2`
  - `final_presentation`
  - `total` is auto-calculated.
- QR generation now creates team-wise folders:
  - `qr_codes/<team_folder>/<mobile>.png`

## Tech Passphrase Protection
- Protected sections: dashboard, evaluations, and exports.
- Default passphrases:
  - `acm@enigma`
  - `youdontknowmeson`
- Override in backend with:
  - `TECH_PASSPHRASES=pass1,pass2`

## Environment Templates
- Backend template: `backend/.env.example`
- Frontend template: `frontend/.env.example`
- Admin website template: `website/.env.example`

Optional local setup from repo root:
```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

## Local Setup

### 1) Start MongoDB
Use local MongoDB (default expected URI: `mongodb://127.0.0.1:27017/`).

### 2) Import participants CSV
```bash
python3 -m pip install pymongo
python3 scripts/import_data.py "Breaking_Enigma_Form_Responses.csv"
```

Notes:
- If `Lab No` is missing/blank, `1000` is used.
- Re-running import updates existing records by mobile (useful when exact lab numbers are assigned later).

### 3) Generate team-wise QR codes
```bash
python3 -m pip install "qrcode[pil]" pandas openpyxl
python3 scripts/generate_qr_codes.py --input "Breaking_Enigma_Form_Responses.csv" --output-dir qr_codes --overwrite
```

### 4) Optional fake test participants (10)
```bash
python3 scripts/seed_fake_participants.py
```

Fake records are clearly tagged with `[FAKE]` and `is_fake: true`.

### 5) Start backend
```bash
cd backend
npm install
node server.js
```

### 6) Start frontend
```bash
cd frontend
npm install
EXPO_PUBLIC_API_URL=<your-lan-ip>:5000 npx expo start --lan
```

### 7) Start the admin visualizer website
This is a separate, read-only companion site that uses the same backend API and MongoDB data.

```bash
cd website
npm install
cp .env.example .env
npm start
```

Required env values for the website:
- `BACKEND_API_URL` - your backend URL, for example `http://127.0.0.1:5000` or the deployed Render URL
- `TECH_PASSPHRASE` - one of the backend passphrases so the site can fetch protected dashboard/evaluation data

Open `http://127.0.0.1:3001` after the server starts.

## Live Deployment (Recommended)

Why local fails for cloud APK builds:
- `localhost` inside the Android app points to the phone/emulator itself, not your laptop.
- EAS cloud builds also cannot access your local `server.js`.

### 1) Deploy MongoDB to Atlas
- Create a cluster.
- Create a database user.
- In Atlas Network Access, add allowed IPs (quick test: `0.0.0.0/0`, then tighten later).
- Copy the `mongodb+srv://...` connection string.

### 2) Deploy backend (`backend/`) to a public host (example: Render Web Service)
- Root Directory: `backend`
- Build Command: `npm install`
- Start Command: `node server.js`
- Health Check Path: `/health`
- Environment variables:
  - `MONGO_URI=<your mongodb+srv connection string>`
  - `TECH_PASSPHRASES=<comma-separated passphrases>`
  - `DEFAULT_LAB_NO=1000`

After deploy, verify:
```bash
curl https://hackathonorganizationapp.onrender.com/health
```

### 3) Set EAS environment variable for frontend builds
From `frontend/`:
```bash
eas env:create --name EXPO_PUBLIC_API_URL --value https://hackathonorganizationapp.onrender.com --environment preview --visibility plaintext
eas env:create --name EXPO_PUBLIC_API_URL --value https://hackathonorganizationapp.onrender.com --environment production --visibility plaintext
```

### 4) Build a new Android APK
```bash
cd frontend
npm run build:android
```

Install the newly generated APK. Older APKs built with `localhost` will keep failing until rebuilt.

## Installable Android + iOS Builds (EAS)

`frontend/eas.json` is configured for internal builds.

### One-time
```bash
cd frontend
npm install -g eas-cli
eas login
eas build:configure
```

### Build Android APK (installable)
```bash
npm run build:android
```

### Build iOS installable build (internal distribution)
```bash
npm run build:ios
```

You’ll get download/install links from EAS build output.
