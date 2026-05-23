const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const CONFIG = {
  urls: {
    home: "https://www.naukri.com/",
    profile: "https://www.naukri.com/mnjuser/profile",
  },

  selectors: {
    loginButton: "a[title='Jobseeker Login']",

    usernameInput:
      "input[placeholder='Enter your active Email ID / Username']",

    passwordInput:
      "input[placeholder='Enter your password']",

    loginSubmitButton: "button[type='submit']",

    updateResumeButton: "input[value='Update resume']",

    viewProfileLink: "//a[normalize-space()='View profile']",

    uploadSuccessMessage:
      "//p[text()='Resume has been successfully uploaded.']",

    fileInput: "input[type='file']",
  },

  browser: {
    headless: "new",

    viewport: {
      width: 1366,
      height: 768,
    },

    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  },

  timeouts: {
    navigation: 90000,
    selector: 30000,
  },

  paths: {
    resume: path.join(
      __dirname,
      "utils",
      "Kunj_Maheshwari.pdf",
    ),

    screenshots: path.join(__dirname, "debug"),
  },
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(min = 500, max = 1500) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return delay(ms);
}

async function captureScreenshot(page, fileName) {
  try {
    if (!fs.existsSync(CONFIG.paths.screenshots)) {
      fs.mkdirSync(CONFIG.paths.screenshots, { recursive: true });
    }

    const filePath = path.join(
      CONFIG.paths.screenshots,
      `${fileName}.png`,
    );

    await page.screenshot({
      path: filePath,
      fullPage: true,
    });

    console.log(`Screenshot saved: ${filePath}`);
  } catch (error) {
    console.log("Failed to capture screenshot");
  }
}

async function launchBrowser() {
  console.log("Launching browser...");

  const browser = await puppeteer.launch({
    headless: CONFIG.browser.headless,
    protocolTimeout: 120000,
    ignoreHTTPSErrors: true,
    defaultViewport: CONFIG.browser.viewport,

    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-features=site-per-process",
      "--disable-http2",
      "--disable-background-networking",
      "--disable-extensions",
      "--disable-sync",
      "--hide-scrollbars",
      "--mute-audio",
      "--disable-notifications",
      "--disable-infobars",
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1366,768",
    ],

    slowMo: CONFIG.browser.headless ? 0 : 50,
  });

  return browser;
}

async function configurePage(page) {
  await page.setViewport(CONFIG.browser.viewport);

  await page.setUserAgent(CONFIG.browser.userAgent);

  await page.setExtraHTTPHeaders({
    "accept-language": "en-US,en;q=0.9",
  });

  page.setDefaultTimeout(CONFIG.timeouts.selector);

  page.setDefaultNavigationTimeout(CONFIG.timeouts.navigation);
}

async function navigate(page, url, label) {
  console.log(`Navigating to ${label}...`);

  await page.goto(url, {
    waitUntil: "networkidle2",
    timeout: CONFIG.timeouts.navigation,
  });

  await delay(12000);

  console.log(`Loaded: ${await page.title()}`);
}

async function login(page, username, password) {
  console.log("[1/5] Opening homepage...");

  await navigate(page, CONFIG.urls.home, "homepage");

  await captureScreenshot(page, "homepage");

  console.log("[2/5] Opening login modal...");

  await page.waitForSelector(CONFIG.selectors.loginButton, {
    visible: true,
    timeout: 30000,
  });

  await page.click(CONFIG.selectors.loginButton);

  await delay(5000);

  console.log("[3/5] Entering credentials...");

  await page.waitForSelector(CONFIG.selectors.usernameInput, {
    visible: true,
    timeout: 30000,
  });

  await page.type(CONFIG.selectors.usernameInput, username, {
    delay: 120,
  });

  await delay(2000);

  await page.type(CONFIG.selectors.passwordInput, password, {
    delay: 120,
  });

  await delay(3000);

  console.log("[4/5] Clicking login button...");

  await Promise.all([
    page.click(CONFIG.selectors.loginSubmitButton),
    page.waitForResponse(
      (response) => {
        return response.url().includes("login") ||
          response.url().includes("auth") ||
          response.status() === 200;
      },
      {
        timeout: 90000,
      },
    ).catch(() => null),
  ]);

  await delay(25000);

  await captureScreenshot(page, "after-login");

  console.log("[5/5] Verifying login...");

  const currentUrl = page.url();

  console.log(`Current URL after login: ${currentUrl}`);

  console.log("Waiting for authenticated session to stabilize...");

  await delay(10000);

  const bodyText = await page.evaluate(() => {
    return document.body ? document.body.innerText : "";
  });

  const loginSuccessful =
    currentUrl.includes("naukri.com") &&
    !currentUrl.includes("login") &&
    (
      bodyText.includes("My Naukri") ||
      bodyText.includes("View profile") ||
      bodyText.includes("Update resume") ||
      bodyText.includes("Profile")
    );

  if (!loginSuccessful) {
    await captureScreenshot(page, "login-failed");

    throw new Error("Login verification failed");
  }

  console.log("Login successful");
}

async function uploadResume(page) {
  console.log("Opening authenticated profile page...");

  await page.goto(CONFIG.urls.profile, {
    waitUntil: "networkidle2",
    timeout: 90000,
  });

  await delay(15000);

  await captureScreenshot(page, "profile-page");

  const currentUrl = page.url();

  console.log(`Profile URL: ${currentUrl}`);

  if (currentUrl.includes("login")) {
    throw new Error("Session expired or redirected to login page");
  }

  console.log("Opening upload control...");

  await page.waitForSelector(
    CONFIG.selectors.updateResumeButton,
    {
      visible: true,
      timeout: 60000,
    },
  );

  const fileInput = await page.$(
    CONFIG.selectors.fileInput,
  );

  if (!fileInput) {
    throw new Error("File input not found");
  }

  if (!fs.existsSync(CONFIG.paths.resume)) {
    throw new Error(
      `Resume file not found: ${CONFIG.paths.resume}`,
    );
  }

  console.log("Uploading resume...");

  await fileInput.uploadFile(CONFIG.paths.resume);

  const uploadSuccess = await page
    .waitForFunction(
      () => {
        return document.body.innerText.includes(
          "Resume has been successfully uploaded.",
        );
      },
      {
        timeout: 10000,
      },
    )
    .then(() => true)
    .catch(() => false);

  if (!uploadSuccess) {
    await captureScreenshot(page, "upload-warning");

    console.log(
      "Success message not detected, but upload may still be completed",
    );
  }

  await delay(3000);

  await captureScreenshot(page, "resume-uploaded");

  console.log("Resume uploaded successfully");
}

async function main() {
  const username = process.env.NAUKRI_USERNAME;

  const password = process.env.NAUKRI_PASSWORD;

  if (!username || !password) {
    throw new Error(
      "Missing NAUKRI_USERNAME or NAUKRI_PASSWORD in .env",
    );
  }

  let browser;

  try {
    console.log("Starting Naukri Resume Automation");

    browser = await launchBrowser();

    const page = await browser.newPage();

    await configurePage(page);

    await page.setCacheEnabled(false);

    await page.setJavaScriptEnabled(true);

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined,
      });

      window.chrome = {
        runtime: {},
      };

      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5],
      });

      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en"],
      });
    });

    await login(page, username, password);

    await uploadResume(page);

    console.log("==================================");
    console.log("Resume updated successfully");
    console.log(`Time: ${new Date().toLocaleString()}`);
    console.log("==================================");

    process.exit(0);
  } catch (error) {
    console.error("Automation Failed");
    console.error(error.message);
    try {
      const pages = await browser.pages();

      if (pages.length > 0) {
        await captureScreenshot(pages[0], "automation-error");
      }
    } catch (_) {}

    process.exit(1);
  } finally {
    if (browser) {
      await browser.close().catch(() => null);
    }
  }
}

main();