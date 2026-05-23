# Naukri Resume Automation

A production-ready Node.js automation script that signs in to Naukri and uploads your latest resume using Puppeteer.

This project is designed for personal productivity workflows where you regularly refresh your profile with an updated resume.

## Features

- Automated login flow for Naukri jobseeker accounts
- Resume upload from a local PDF file
- Basic anti-bot hardening via browser launch flags and human-like typing delays
- Debug screenshots captured at key checkpoints
- Environment-variable-based credential handling
- Scripted npm commands for run and validation

## Tech Stack

- Node.js
- Puppeteer
- dotenv

## Project Structure

```text
.
├── NaukriResumeScript.js         # Main automation script
├── package.json                  # Scripts and dependencies
├── README.md                     # Project documentation
├── debug/
│   ├── files/
│   ├── logs/
│   └── screenshots/
└── utils/
   └── Kunj_Maheshwari.pdf       # Resume file uploaded by default
```

Note: The current script stores screenshots under `debug/` (root of debug) using generated names like `homepage.png` and `after-login.png`.

## Prerequisites

- macOS, Linux, or Windows
- Node.js 18+ (recommended Node.js 20+)
- npm 9+
- A valid Naukri account

## Installation

1. Clone this repository.
2. Install dependencies:

```bash
npm install
```

## Environment Configuration

Create a `.env` file in the project root:

```env
NAUKRI_USERNAME=your_email_or_username
NAUKRI_PASSWORD=your_password
HEADLESS=false
```

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `NAUKRI_USERNAME` | Yes | None | Naukri login email/username |
| `NAUKRI_PASSWORD` | Yes | None | Naukri account password |
| `HEADLESS` | No | `false` | Runs browser in background when set to `true` |

## Resume File Configuration

By default, the script uploads:

`utils/Kunj_Maheshwari.pdf`

If you want to use a different file:

1. Replace the file in `utils/`, or
2. Update `CONFIG.paths.resume` in `NaukriResumeScript.js`.

## Usage

Validate required variables:

```bash
npm run validate:env
```

Run automation:

```bash
npm run upload:resume
```

Alternative:

```bash
npm start
```

## What the Script Does

1. Launches Chromium with configured options.
2. Opens Naukri homepage.
3. Opens login modal and submits credentials.
4. Verifies successful login.
5. Navigates to profile page.
6. Opens upload control and uploads resume PDF.
7. Captures screenshots and exits with success/failure status.

## Output and Debugging

The script logs progress to console and captures screenshots such as:

- `debug/homepage.png`
- `debug/after-login.png`
- `debug/profile-page.png`
- `debug/resume-uploaded.png`
- `debug/automation-error.png` (on failures)

Use these files to troubleshoot flow breaks due to UI updates or login interruptions.

## Exit Codes

- `0`: Resume upload flow completed
- `1`: Script failed (login issue, selector mismatch, missing resume, etc.)

## Common Issues and Fixes

### Missing Environment Variables

Error:

`Missing NAUKRI_USERNAME or NAUKRI_PASSWORD in .env`

Fix:

- Ensure `.env` exists in project root.
- Ensure both variables are defined correctly.

### Resume File Not Found

Error:

`Resume file not found: ...`

Fix:

- Confirm the file exists at the configured path.
- Confirm filename and extension match exactly.

### Login Verification Failed

Potential reasons:

- Invalid credentials
- Naukri UI changed
- Additional challenge step shown (captcha/OTP)

Fix:

- Run with `HEADLESS=false` for visible browser debugging.
- Check the latest screenshot artifacts in `debug/`.

## Security and Compliance Notes

- Never commit `.env` or credentials to source control.
- Use this script only for your own account and lawful automation.
- Websites can change markup, anti-bot behavior, and policy without notice; update selectors accordingly.

## Maintenance Guidance

If the flow breaks after a site update, review and update these selector entries in `NaukriResumeScript.js`:

- `CONFIG.selectors.loginButton`
- `CONFIG.selectors.usernameInput`
- `CONFIG.selectors.passwordInput`
- `CONFIG.selectors.loginSubmitButton`
- `CONFIG.selectors.updateResumeButton`
- `CONFIG.selectors.fileInput`

## NPM Scripts

| Script | Command | Purpose |
|---|---|---|
| `upload:resume` | `node NaukriResumeScript.js` | Run full automation flow |
| `start` | `npm run upload:resume` | Alias for automation run |
| `validate:env` | Node inline validator | Validate required env vars |

## License

ISC