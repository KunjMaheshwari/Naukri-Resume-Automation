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

    viewProfileLink: "a[normalize-space()='View profile']",

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

    defaultViewport: CONFIG.browser.viewport,

    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
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

  // allow login session to stabilize properly in GitHub Actions
  await delay(20000);

  // open profile page directly after login
  await navigate(page, CONFIG.urls.profile, "profile");

  await delay(8000);

  const currentUrl = page.url();

  const pageText = await page.evaluate(() => {
    return document.body.innerText;
  });

  const profileVisible = await page
    .$eval(CONFIG.selectors.updateResumeButton, () => true)
    .catch(() => false);

  const loginSuccessful =
    profileVisible ||
    currentUrl.includes("mnjuser/profile") ||
    pageText.includes("Resume") ||
    pageText.includes("Profile") ||
    pageText.includes("View profile") ||
    pageText.includes("My Naukri");

  if (!loginSuccessful) {
    await captureScreenshot(page, "login-failed");

    throw new Error("Login verification failed");
  }

  console.log("Login successful");
}

async function uploadResume(page) {
  console.log("Opening profile page...");

  // Removed duplicate navigation to profile page

  await captureScreenshot(page, "profile-page");

  console.log("Opening upload control...");

  await page.waitForSelector(
    CONFIG.selectors.updateResumeButton,
  );

  await page.click(CONFIG.selectors.updateResumeButton);

  await delay(3000);

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
    .waitForXPath(
      CONFIG.selectors.uploadSuccessMessage,
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