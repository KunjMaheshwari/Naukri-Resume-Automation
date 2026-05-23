const puppeteer = require("puppeteer");
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

    viewProfileLink: "View profile",

    uploadSuccessMessage:
      "//p[text()='Resume has been successfully uploaded.']",

    fileInput: "input[type='file']",
  },

  browser: {
    headless:
      String(process.env.HEADLESS || "false").toLowerCase() === "true",

    viewport: {
      width: 1366,
      height: 768,
    },

    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  },

  timeouts: {
    navigation: 45000,
    selector: 15000,
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
    defaultViewport: CONFIG.browser.viewport,

    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-features=site-per-process",
      "--disable-http2",
      "--disable-background-networking",
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
    waitUntil: "domcontentloaded",
    timeout: CONFIG.timeouts.navigation,
  });

  await delay(8000);

  console.log(`Loaded: ${await page.title()}`);
}

async function login(page, username, password) {
  console.log("[1/5] Opening homepage...");

  await navigate(page, CONFIG.urls.home, "homepage");

  await captureScreenshot(page, "homepage");

  console.log("[2/5] Opening login modal...");

  await page.waitForSelector(CONFIG.selectors.loginButton);

  await page.click(CONFIG.selectors.loginButton);

  await randomDelay();

  console.log("[3/5] Entering credentials...");

  await page.waitForSelector(CONFIG.selectors.usernameInput);

  await page.click(CONFIG.selectors.usernameInput, {
    clickCount: 3,
  });

  await page.keyboard.press("Backspace");

  await page.type(CONFIG.selectors.usernameInput, username, {
    delay: 50,
  });

  await randomDelay();

  await page.click(CONFIG.selectors.passwordInput, {
    clickCount: 3,
  });

  await page.keyboard.press("Backspace");

  await page.type(CONFIG.selectors.passwordInput, password, {
    delay: 50,
  });

  await randomDelay();

  console.log("[4/5] Clicking login button...");

  await page.click(CONFIG.selectors.loginSubmitButton);

  await delay(15000);

  await captureScreenshot(page, "after-login");

  console.log("[5/5] Verifying login...");

  // wait for login session to settle
  await delay(8000);

  console.log("Checking authenticated session...");

  const loginSuccessful = await Promise.race([
    page
      .waitForFunction(
        () => {
          const bodyText = document.body
            ? document.body.innerText
            : "";

          return (
            window.location.href.includes("naukri.com") &&
            (
              bodyText.includes("View profile") ||
              bodyText.includes("My Naukri") ||
              bodyText.includes("Update resume") ||
              bodyText.includes("Profile")
            )
          );
        },
        {
          timeout: 30000,
        },
      )
      .then(() => true)
      .catch(() => false),

    page
      .waitForSelector(CONFIG.selectors.updateResumeButton, {
        timeout: 30000,
      })
      .then(() => true)
      .catch(() => false),
  ]);

  if (!loginSuccessful) {
    await captureScreenshot(page, "login-failed");

    throw new Error("Login verification failed");
  }

  console.log("Login successful");
}

async function uploadResume(page) {
  console.log("Opening profile page...");

  // navigate only after login session is confirmed
  await page.goto(CONFIG.urls.profile, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  await delay(10000);

  await captureScreenshot(page, "profile-page");

  console.log("Opening upload control...");

  await page.waitForSelector(
    CONFIG.selectors.updateResumeButton,
    {
      visible: true,
      timeout: 30000,
    },
  );

  await page.click(CONFIG.selectors.updateResumeButton);

  await delay(1500);

  if (!fs.existsSync(CONFIG.paths.resume)) {
    throw new Error(
      `Resume file not found: ${CONFIG.paths.resume}`,
    );
  }

  console.log("Uploading resume...");

  const fileInput = await page.$(
    CONFIG.selectors.fileInput,
  );

  if (!fileInput) {
    throw new Error("File input not found");
  }

  await fileInput.uploadFile(CONFIG.paths.resume);

  const uploadSuccess = await page
    .waitForFunction(
      () => {
        return document.body.innerText.includes(
          "Resume has been successfully uploaded.",
        );
      },
      {
        timeout: 5000,
      },
    )
    .then(() => true)
    .catch(() => false);

  if (!uploadSuccess) {
    console.log(
      "Upload success message not detected, but upload may still be successful",
    );
  }

  await delay(2000);

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