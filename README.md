# HackathonOrganizationApp

A React Native-based Expo app for organizing and managing hackathons or events seamlessly based on registration data. Designed to scale for 1000+ participants with minimal latency.

## Architecture

* **Frontend:** React Native / Expo (Camera, Haptics, Axios)
* **Backend:** Node.js, Express, Mongoose
* **Database:** MongoDB
* **Data Pipeline:** Python (pymongo)

## Prerequisites

* Node.js (v16 or higher)
* Python 3
* MongoDB (running locally on port 27017)
* Expo Go (installed on your physical device for testing)

## Project Structure

* `/backend` - Node.js/Express server and MongoDB models.
* `/frontend` - Expo/React Native application.
* `import_data.py` - Python script for bulk importing registration data.

## Setup Instructions

### 1. Database and Data Import

1. Ensure your local MongoDB instance is running at `mongodb://localhost:27017`.
2. Place your event registration data in a file named `participants.csv` in the root directory.
   The CSV must contain the following exact column headers:
   * `Candidate's Mobile`
   * `Candidate's Name`
   * `Team Name`
   * `Lab No`
3. Run the import script to populate the database:

   ```bash
   pip install pymongo
   python3 import_data.py
   ```

### 2. Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   node server.js
   ```
   The backend will be available at `http://localhost:5000`.

### 3. Frontend Setup

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Update the API Address:
   Open `frontend/app/index.tsx` and map `API_URL` to your machine's **Internal IP Address** (e.g., `http://192.168.1.100:5000`) rather than `localhost`.
4. Start the Expo development server:
   ```bash
   npx expo start --lan 
   or
  EXPO_PUBLIC_API_URL=<your-internal-ip>:5000 npx expo start --lan
   ```
5. Scan the QR code presented in the terminal using the Expo Go app on your phone.

## Important Note: The Localhost Trap

When testing the Expo app on your physical mobile device, you cannot use `localhost` in your API calls, because your phone does not know what `localhost` is. 

**Fix:** Use your laptop's Internal IP Address (e.g., `192.168.1.XX:5000`) in `frontend/app/index.tsx` or use Ngrok to create a temporary public URL for your local backend.

## Features

* **Quick Check-in:** Scan participant QR codes (containing their mobile number) to register their attendance instantly.
* **Multi-action Toggles:** Switch between Registration, RedBull, and Dinner claims directly from a single screen.
* **Manual Entry:** Search bar provided for manual mobile number entry in case a QR code is unreadable.
* **Live Stats:** Real-time counter of checked-in participants.
* **Fast Feedback:** Huge success (Green) or error (Red) screen overlays appear for 2 seconds alongside haptic vibration feedback for every action.
