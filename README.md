# Workout Every Morning

A mobile-first web app for tracking cardio workouts by photographing your machine's display screen.

## How It Works

1. Take a photo of your treadmill / elliptical / bike summary screen
2. GPT-5.2 extracts the workout data (duration, calories, distance, speed, heart rate, etc.)
3. Data is saved to Firebase Firestore
4. View your progress over time with bar charts

## Setup

### Prerequisites

- An **OpenAI API key** (with access to gpt-5.2 vision)
- A **Firebase project** with Firestore enabled

### Firebase Configuration

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable Firestore Database
3. Copy your web app config into `src/config.js` (`FIREBASE_CONFIG` object)
4. Set Firestore security rules (see `docs/firestore-rules.md`)

### Deploy to GitHub Pages

Push this repo to GitHub and enable Pages from the repository settings (serve from the root of the `main` branch).

## Project Structure

```
index.html          Single-page app shell
css/style.css       Mobile-first responsive styles
src/
  app.js            App init, screen routing
  config.js         Firebase config, constants
  setup.js          First-time setup (username + API key)
  llm.js            OpenAI Vision API integration
  firebase.js       Firestore read/write
  capture.js        Photo capture and extraction flow
  history.js        Workout history charts and list
  utils.js          Shared helpers
docs/
  design.md         Design document
  tech-stack.md     Tech stack rationale
```

## Tech Stack

- Vanilla JavaScript (ES modules, no build step)
- Chart.js v4 (bar charts)
- Firebase Firestore v10 (CDN compat SDK)
- OpenAI gpt-5.2 (vision extraction)
- Hosted on GitHub Pages

## Firestore Maintenance Scripts

These scripts help with safe data maintenance for the `workouts` collection:

- Back up all documents into a dated backup collection
- Report `machineType` distribution
- Migrate existing docs to `machineType = "eliptical"`

### Prerequisites

- Install dependencies once:
  - `npm install`
- Create a Firebase service account JSON with Firestore permissions.
- Set environment variable (PowerShell):
  - `$env:FIREBASE_SERVICE_ACCOUNT_PATH="C:\path\to\service-account.json"`
- On systems where PowerShell blocks `npm`, use `npm.cmd` instead (for example `npm.cmd run machine-type:report`).

### Scripts

- `npm run machine-type:report`
  - Prints document count and `machineType` distribution for `workouts`.
  - Optional collection override:
    - `npm run machine-type:report -- --collection=workouts_backup_YYYYMMDD_HHMMSSZ`

- `npm run machine-type:backup`
  - Copies all docs from `workouts` into a new Firestore collection named:
    - `workouts_backup_<UTC timestamp>`
  - Optional custom target:
    - `npm run machine-type:backup -- --target=workouts_backup_before_machine_type_patch`

- `npm run machine-type:migrate:dry`
  - Shows how many docs would be updated to `machineType = "eliptical"` without writing.

- `npm run machine-type:migrate`
  - Applies the machine-type update.

### Suggested workflow

1. `npm run machine-type:report`
2. `npm run machine-type:backup`
3. `npm run machine-type:migrate:dry`
4. `npm run machine-type:migrate`
5. `npm run machine-type:report`

### Where backups go

Backups are stored in Firestore as a new collection (not as local files).
The script prints the exact backup collection name when it finishes.

### Restore from backup (if needed)

If a migration needs to be reverted:

1. Re-run backup first (to preserve current state)
2. Copy backup docs back into `workouts` with:
   - `npm run machine-type:backup -- --source=<backup_collection_name> --target=workouts`
