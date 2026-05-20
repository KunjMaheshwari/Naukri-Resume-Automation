const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

if (!process.env.NAUKRI_USERNAME || !process.env.NAUKRI_PASSWORD) {
  throw new Error("Missing required environment variables");
}

// puppeteer-extra-plugin-stealth patches common Chromium automation fingerprints.
// The page-level overrides below cover signals that can still leak in cloud runners.
puppeteer.use(StealthPlugin());

const username = process.env.NAUKRI_USERNAME;
const password = process.env.NAUKRI_PASSWORD;
const debugMode = String(process.env.DEBUG_MODE || "").toLowerCase() === "true";

const debugDir = path.join(__dirname, "debug");
const screenshotDir = path.join(debugDir, "screenshots");
const fileDumpDir = path.join(debugDir, "files");

const userAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const viewport = {
  width: 1366,
  height: 768,
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
};

const selectors = {
  loginLink: "a[title='Jobseeker Login']",
  usernameInput: "input[placeholder='Enter your active Email ID / Username']",
  passwordInput: "input[placeholder='Enter your password']",
  submitButton: "button[type='submit']",
  loggedInDrawer: ".nI-gNb-drawer__bars",
  updateResumeButton: "input[value='Update resume']",
  fileInput: "input[type='file']",
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomInt = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;
const humanPause = (min = 450, max = 1400) => delay(randomInt(min, max));

function ensureDebugDirs() {
  fs.mkdirSync(screenshotDir, { recursive: true });
  fs.mkdirSync(fileDumpDir, { recursive: true });
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function captureScreenshot(page, label, options = {}) {
  if (!page) return;

  ensureDebugDirs();
  const screenshotPath = path.join(
    screenshotDir,
    `${label}_${timestamp()}.png`,
  );
  await page.screenshot({
    path: screenshotPath,
    fullPage: options.fullPage ?? true,
  });
  console.log(`Screenshot saved: ${screenshotPath}`);
}

async function dumpHtml(page, label) {
  if (!page) return;

  ensureDebugDirs();
  const htmlPath = path.join(fileDumpDir, `${label}_${timestamp()}.html`);
  const html = await page.content();
  fs.writeFileSync(htmlPath, html);
  console.error(`HTML dump saved: ${htmlPath}`);
}

async function waitForPageSettle(page, timeout = 8000) {
  try {
    await page.waitForNetworkIdle({ idleTime: 750, timeout });
  } catch {
    await humanPause(800, 1600);
  }
}

async function moveMouseNaturally(page) {
  const startX = randomInt(40, viewport.width - 80);
  const startY = randomInt(80, viewport.height - 120);
  const endX = randomInt(120, viewport.width - 160);
  const endY = randomInt(160, viewport.height - 160);

  await page.mouse.move(startX, startY, { steps: randomInt(8, 14) });
  await humanPause(150, 400);
  await page.mouse.move(endX, endY, { steps: randomInt(12, 24) });
}

async function clickLikeHuman(page, selector, options = {}) {
  const element = await page.waitForSelector(selector, {
    timeout: options.timeout || 15000,
    visible: true,
  });
  const box = await element.boundingBox();

  if (box) {
    await page.mouse.move(
      box.x + (box.width * randomInt(35, 65)) / 100,
      box.y + (box.height * randomInt(35, 65)) / 100,
      { steps: randomInt(12, 24) },
    );
    await humanPause(120, 350);
  }

  await element.click({ delay: randomInt(60, 180) });
}

async function typeLikeHuman(page, selector, value) {
  await page.waitForSelector(selector, { timeout: 15000, visible: true });
  await clickLikeHuman(page, selector);
  await page.keyboard.down(process.platform === "darwin" ? "Meta" : "Control");
  await page.keyboard.press("A");
  await page.keyboard.up(process.platform === "darwin" ? "Meta" : "Control");
  await humanPause(150, 400);

  for (const char of value) {
    await page.keyboard.type(char, { delay: randomInt(45, 140) });
    if (Math.random() < 0.08) {
      await humanPause(120, 360);
    }
  }
}

async function configurePage(page) {
  await page.setViewport(viewport);
  await page.setUserAgent(userAgent);
  await page.setExtraHTTPHeaders({
    "accept-language": "en-US,en;q=0.9",
    "upgrade-insecure-requests": "1",
  });

  try {
    await page.emulateTimezone("Asia/Kolkata");
  } catch {
    console.warn("Timezone emulation is unavailable in this Chromium build.");
  }

  // These overrides reduce obvious automation signals before any site script runs.
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => undefined,
    });

    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en"],
    });

    Object.defineProperty(navigator, "platform", {
      get: () => "Win32",
    });

    window.chrome = window.chrome || { runtime: {} };
  });
}

async function detectBlockingSignals(page, context) {
  const signals = await page.evaluate(() => {
    const bodyText = document.body ? document.body.innerText.toLowerCase() : "";
    const captchaSelectors = [
      '[class*="captcha" i]',
      '[id*="captcha" i]',
      'iframe[src*="captcha" i]',
      'iframe[src*="recaptcha" i]',
    ];

    return {
      url: window.location.href,
      title: document.title,
      hasCaptchaElement: captchaSelectors.some((selector) =>
        Boolean(document.querySelector(selector)),
      ),
      hasCaptchaText: /captcha|recaptcha|verify you are human|robot/.test(
        bodyText,
      ),
      hasBlockedText:
        /something went wrong|suspicious activity|temporarily blocked|access denied|try again later/.test(
          bodyText,
        ),
      hasFailedLoginText:
        /invalid|incorrect|wrong password|login failed|please try again/.test(
          bodyText,
        ),
    };
  });

  if (debugMode) {
    console.log(`${context} detection signals: ${JSON.stringify(signals)}`);
  }

  if (signals.hasCaptchaElement || signals.hasCaptchaText) {
    throw new Error(`${context}: CAPTCHA or human verification detected`);
  }

  if (signals.hasBlockedText) {
    throw new Error(
      `${context}: blocked or suspicious login response detected`,
    );
  }

  if (signals.hasFailedLoginText) {
    throw new Error(`${context}: failed login banner detected`);
  }
}

async function launchBrowser() {
  return puppeteer.launch({
    headless: "new",
    defaultViewport: viewport,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--disable-gpu",
      "--disable-infobars",
      "--disable-notifications",
      "--disable-popup-blocking",
      "--lang=en-US,en",
      "--window-size=1366,768",
    ],
  });
}

async function performLogin(page, attempt) {
  console.log(`[2/7] Login attempt ${attempt}: opening Naukri homepage...`);
  await page.goto("https://www.naukri.com/", {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await waitForPageSettle(page);
  await detectBlockingSignals(page, `login attempt ${attempt} homepage`);

  console.log(`[2/7] Login attempt ${attempt}: opening login form...`);
  await moveMouseNaturally(page);
  await clickLikeHuman(page, selectors.loginLink);
  await page.waitForSelector(selectors.usernameInput, {
    timeout: 15000,
    visible: true,
  });
  await waitForPageSettle(page, 5000);
  await captureScreenshot(page, `before-login-attempt-${attempt}`);

  console.log(`[2/7] Login attempt ${attempt}: entering username...`);
  await typeLikeHuman(page, selectors.usernameInput, username);
  await humanPause(500, 1200);

  console.log(`[2/7] Login attempt ${attempt}: entering password...`);
  await typeLikeHuman(page, selectors.passwordInput, password);
  await humanPause(700, 1500);

  console.log(`[2/7] Login attempt ${attempt}: submitting login form...`);
  const navigationPromise = page
    .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 })
    .catch(() => null);
  await clickLikeHuman(page, selectors.submitButton);
  await navigationPromise;
  await waitForPageSettle(page, 10000);
  await captureScreenshot(page, `after-login-click-attempt-${attempt}`);

  console.log(`[3/7] Login attempt ${attempt}: validating post-login state...`);
  await detectBlockingSignals(page, `login attempt ${attempt} post-submit`);

  try {
    await page.waitForSelector(selectors.loggedInDrawer, {
      timeout: 15000,
      visible: true,
    });
    console.log(`[3/7] Login attempt ${attempt}: login successful`);
    return;
  } catch {
    await dumpHtml(page, `login-validation-failed-attempt-${attempt}`);
    throw new Error(
      `Login attempt ${attempt} did not reach authenticated state`,
    );
  }
}

async function loginWithRetry(page, maxAttempts = 2) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await performLogin(page, attempt);
      return;
    } catch (error) {
      lastError = error;
      console.error(`Login attempt ${attempt} failed: ${error.message}`);
      await captureScreenshot(page, `login-attempt-${attempt}-failure`);
      await dumpHtml(page, `login-attempt-${attempt}-failure`);

      if (attempt < maxAttempts) {
        console.log(`Retrying login after a fresh page load...`);
        await humanPause(2500, 5500);
        await page.goto("about:blank", { waitUntil: "domcontentloaded" });
      }
    }
  }

  throw lastError;
}

(async () => {
  console.log("Starting resume update process...");
  console.log(`Debug mode: ${debugMode ? "enabled" : "disabled"}`);

  let browser;
  let page;

  try {
    browser = await launchBrowser();
    page = await browser.newPage();
    await configurePage(page);

    console.log("[1/7] Browser session initialized with stealth configuration");

    await loginWithRetry(page);

    console.log("[4/7] Navigating to profile...");
    await page.goto("https://www.naukri.com/mnjuser/profile", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await waitForPageSettle(page);
    await detectBlockingSignals(page, "profile page");

    console.log("[5/7] Opening resume upload control...");
    await clickLikeHuman(page, selectors.updateResumeButton, {
      timeout: 20000,
    });
    await page.waitForSelector(selectors.fileInput, { timeout: 15000 });
    await humanPause(800, 1800);

    console.log("[6/7] Uploading resume file...");
    const resumePath = path.join(__dirname, "utils", "Kunj_Maheshwari.pdf");
    if (!fs.existsSync(resumePath)) {
      throw new Error(`Resume file not found at: ${resumePath}`);
    }

    const fileInput = await page.$(selectors.fileInput);
    if (!fileInput) {
      throw new Error("Resume file input was not found");
    }

    await fileInput.uploadFile(resumePath);
    await Promise.race([
      page
        .waitForSelector(".upload-success", { timeout: 10000 })
        .catch(() => null),
      waitForPageSettle(page, 10000),
    ]);
    await detectBlockingSignals(page, "resume upload");

    if (debugMode) {
      await captureScreenshot(page, "resume-upload-complete");
    }

    console.log("[7/7] Resume update completed successfully");
    console.log(`Resume uploaded at: ${new Date().toLocaleString()}`);
    console.log(`Timestamp: ${Date.now()}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);

    if (page) {
      await captureScreenshot(page, "failure");
      await dumpHtml(page, "failure");
    }

    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
