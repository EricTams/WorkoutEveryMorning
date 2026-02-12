# Tech Stack

## Platform
- **Static web app** -- vanilla HTML/CSS/JS, no framework, no build step
- **Hosting** -- GitHub Pages (static files only)
- **Target** -- mobile browsers (phone-first responsive design)

## Language
- **Vanilla JavaScript** -- ES modules via `<script type="module">`
- No TypeScript, no transpiler, no bundler

## External Services

### OpenAI API
- **Model**: `gpt-5.2` (flagship vision-capable model)
- **Endpoint**: `https://api.openai.com/v1/chat/completions`
- **Auth**: user-supplied API key stored in localStorage
- **Usage**: extract structured workout data from photos of cardio machine screens

### Firebase Firestore
- **SDK**: v10 compat mode via CDN (`firebase-app-compat.js`, `firebase-firestore-compat.js`)
- **Collection**: `workouts` -- stores extracted workout documents
- **Auth**: none (honor-system username matching in Firestore rules)

## Libraries (CDN)

| Library    | Version | Purpose                        |
|------------|---------|--------------------------------|
| Chart.js   | v4      | Bar charts for workout history |
| Firebase   | v10     | Firestore database             |

No npm, no node_modules. All dependencies loaded from CDN in `index.html`.

## Data Storage
- **Firestore** -- workout records (cloud, queryable)
- **localStorage** -- username and API key (device-local, never sent to our servers)

## Camera / Image
- HTML5 `<input type="file" accept="image/*" capture="environment">`
- Client-side resize via `<canvas>` before sending to OpenAI (target ~1024px max dimension)
- `FileReader.readAsDataURL()` for base64 encoding
