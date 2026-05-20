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
  usernameInput: "input[placeholder='Enter your active Email ID / Username']",
  passwordInput: "input[placeholder='Enter your password']",
  submitButton: "button[type='submit']",
  loggedInDrawer: ".nI-gNb-drawer__bars",
  updateResumeButton: "input[value='Update resume']",
  fileInput: "input[type='file']",
};

// Verified Naukri login modal XPaths are primary because they have been stable
// across local Chrome and GitHub-hosted Linux runner rendering.
const xpaths = {
  loginButton: "//a[@title='Jobseeker Login']",
  usernameInput:
    "//input[@placeholder='Enter your active Email ID / Username']",
  passwordInput: "//input[@placeholder='Enter your password']",
  submitButton: "//button[text()='Login']",
};

const loginButtonCandidates = {
  xpath: [
    "//a[@title='Jobseeker Login']",
    "//a[contains(text(),'Login')]",
    "//button[contains(text(),'Login')]",
  ],
  css: [
    "a[title='Jobseeker Login']",
    "a.login",
    "button.login",
    "[data-ga-track*='login']",
  ],
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

async function waitForDomStabilization(page, context) {
  await page.waitForSelector("body", { timeout: 15000, visible: true });
  await page
    .waitForFunction(
      () =>
        ["interactive", "complete"].includes(document.readyState) &&
        document.body &&
        document.body.children.length > 0,
      { timeout: 15000 },
    )
    .catch(() => null);
  await waitForPageSettle(page, 10000);
  await page
    .waitForFunction(
      () => {
        const bodyText = document.body ? document.body.innerText.trim() : "";
        return (
          bodyText.length > 20 ||
          document.querySelectorAll("a, button").length > 0
        );
      },
      { timeout: 10000 },
    )
    .catch(() => console.warn(`${context}: rendered text wait timed out`));
}

async function getPageDiagnostics(page) {
  return page.evaluate(() => {
    const bodyText = document.body
      ? document.body.innerText.replace(/\s+/g, " ").trim()
      : "";
    const clickableCount = document.querySelectorAll(
      "a, button, [role='button']",
    ).length;

    return {
      title: document.title || "",
      url: window.location.href,
      bodyTextLength: bodyText.length,
      bodyTextPreview: bodyText.slice(0, 300),
      clickableCount,
      isLikelyBlank:
        bodyText.length < 20 &&
        clickableCount === 0 &&
        document.querySelectorAll("input, form").length === 0,
    };
  });
}

function logPageDiagnostics(context, diagnostics) {
  console.log(`${context}: page title="${diagnostics.title}"`);
  console.log(`${context}: url=${diagnostics.url}`);
  console.log(`${context}: clickable elements=${diagnostics.clickableCount}`);
  console.log(`${context}: body preview="${diagnostics.bodyTextPreview}"`);
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

async function isElementClickable(element) {
  if (!element) return false;

  try {
    const state = await element.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const topElement = document.elementFromPoint(centerX, centerY);

      return {
        visible:
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) > 0.01,
        enabled:
          !node.disabled &&
          node.getAttribute("aria-disabled") !== "true" &&
          style.pointerEvents !== "none",
        inViewport:
          rect.bottom >= 0 &&
          rect.right >= 0 &&
          rect.top <= window.innerHeight &&
          rect.left <= window.innerWidth,
        receivesPointer:
          !topElement || node === topElement || node.contains(topElement),
      };
    });

    const box = await element.boundingBox();
    return Boolean(
      box &&
        state.visible &&
        state.enabled &&
        state.inViewport &&
        state.receivesPointer,
    );
  } catch {
    return false;
  }
}

async function scrollElementIntoView(element) {
  await element.evaluate((node) => {
    node.scrollIntoView({
      block: "center",
      inline: "center",
      behavior: "auto",
    });
  });
  await humanPause(200, 500);
}

async function clickElementLikeHuman(page, element) {
  await scrollElementIntoView(element);
  const box = await element.boundingBox();

  if (box) {
    await page.mouse.move(
      box.x + (box.width * randomInt(35, 65)) / 100,
      box.y + (box.height * randomInt(35, 65)) / 100,
      { steps: randomInt(12, 24) },
    );
    await humanPause(120, 350);
    await element.hover().catch(() => null);
    await humanPause(120, 320);
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await element.click({ delay: randomInt(60, 180) });
      return;
    } catch (error) {
      if (attempt === 2) {
        console.warn(
          `Direct click failed twice, using DOM click fallback: ${error.message}`,
        );
        await element.evaluate((node) => node.click());
        return;
      }

      console.warn(`Click attempt ${attempt} was intercepted, retrying...`);
      await humanPause(500, 1000);
      await scrollElementIntoView(element).catch(() => null);
    }
  }
}

async function clickLikeHuman(page, selector, options = {}) {
  const element = await page.waitForSelector(selector, {
    timeout: options.timeout || 15000,
    visible: true,
  });
  await clickElementLikeHuman(page, element);
}

async function findElementsByXPath(page, xpath) {
  const arrayHandle = await page.evaluateHandle((expression) => {
    const result = document.evaluate(
      expression,
      document,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );
    return Array.from({ length: result.snapshotLength }, (_, index) =>
      result.snapshotItem(index),
    );
  }, xpath);

  const properties = await arrayHandle.getProperties();
  const elements = [];

  for (const property of properties.values()) {
    const element = property.asElement();
    if (element) {
      elements.push(element);
    } else {
      await property.dispose();
    }
  }

  await arrayHandle.dispose();
  return elements;
}

async function findVisibleXPath(page, xpath) {
  const elements = await findElementsByXPath(page, xpath);

  for (const element of elements) {
    await scrollElementIntoView(element).catch(() => null);
    if (await isElementClickable(element)) {
      console.log(`Visible XPath matched: ${xpath}`);
      return element;
    }
  }

  return null;
}

async function waitForXPathVisible(page, xpath, options = {}) {
  const timeout = options.timeout || 15000;
  const pollInterval = options.pollInterval || 350;
  const startedAt = Date.now();

  console.log(`Waiting for XPath visible: ${xpath}`);
  while (Date.now() - startedAt < timeout) {
    const element = await findVisibleXPath(page, xpath);
    if (element) {
      return element;
    }

    await delay(pollInterval);
  }

  throw new Error(`Timed out waiting for visible XPath: ${xpath}`);
}

// XPath helpers use document.evaluate instead of deprecated Puppeteer XPath APIs,
// keeping this compatible with current Puppeteer releases.
async function clickXPath(page, xpath, options = {}) {
  console.log(`Clicking XPath: ${xpath}`);
  const element = await waitForXPathVisible(page, xpath, options);
  await clickElementLikeHuman(page, element);
  return element;
}

async function findVisibleCss(page, selector) {
  const elements = await page.$$(selector);

  for (const element of elements) {
    await scrollElementIntoView(element).catch(() => null);
    if (await isElementClickable(element)) {
      console.log(`Visible CSS selector matched: ${selector}`);
      return element;
    }
  }

  return null;
}

async function waitForCssVisible(page, selector, options = {}) {
  const timeout = options.timeout || 15000;
  const pollInterval = options.pollInterval || 350;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    const element = await findVisibleCss(page, selector);
    if (element) {
      return element;
    }

    await delay(pollInterval);
  }

  throw new Error(`Timed out waiting for visible CSS selector: ${selector}`);
}

async function typeIntoElement(page, element, value) {
  await clickElementLikeHuman(page, element);
  await page.keyboard.down(process.platform === "darwin" ? "Meta" : "Control");
  await page.keyboard.press("A");
  await page.keyboard.up(process.platform === "darwin" ? "Meta" : "Control");
  await page.keyboard.press("Backspace");
  await humanPause(200, 500);

  for (const char of value) {
    await page.keyboard.type(char, { delay: randomInt(55, 155) });
    if (Math.random() < 0.1) {
      await humanPause(120, 380);
    }
  }
}

async function typeXPath(page, xpath, value, options = {}) {
  console.log(`Typing into XPath: ${xpath}`);
  const element = await waitForXPathVisible(page, xpath, options);
  await typeIntoElement(page, element, value);
  return element;
}

async function typeXPathWithCssFallback(page, xpath, selector, value, label) {
  try {
    return await typeXPath(page, xpath, value, { timeout: 12000 });
  } catch (error) {
    console.warn(
      `${label}: XPath typing fallback to CSS after: ${error.message}`,
    );
    const element = await waitForCssVisible(page, selector, { timeout: 8000 });
    await typeIntoElement(page, element, value);
    return element;
  }
}

async function clickXPathWithCssFallback(page, xpath, selector, label) {
  try {
    return await clickXPath(page, xpath, { timeout: 12000 });
  } catch (error) {
    console.warn(
      `${label}: XPath click fallback to CSS after: ${error.message}`,
    );
    const element = await waitForCssVisible(page, selector, { timeout: 8000 });
    await clickElementLikeHuman(page, element);
    return element;
  }
}

async function findClickableCandidate(page, candidates, type) {
  for (const candidate of candidates) {
    console.log(`Trying ${type} login selector: ${candidate}`);
    const elements =
      type === "CSS"
        ? await page.$$(candidate)
        : await findElementsByXPath(page, candidate);

    for (const element of elements) {
      await scrollElementIntoView(element).catch(() => null);
      if (await isElementClickable(element)) {
        console.log(`Login button discovered using ${type}: ${candidate}`);
        return { element, selector: candidate, type };
      }
    }
  }

  return null;
}

async function findLoginButton(page) {
  for (let discoveryAttempt = 1; discoveryAttempt <= 2; discoveryAttempt += 1) {
    await waitForDomStabilization(
      page,
      `login discovery attempt ${discoveryAttempt}`,
    );
    const diagnostics = await getPageDiagnostics(page);
    logPageDiagnostics(
      `login discovery attempt ${discoveryAttempt}`,
      diagnostics,
    );

    if (diagnostics.isLikelyBlank) {
      console.warn(
        `login discovery attempt ${discoveryAttempt}: page appears blank or incomplete`,
      );
    }

    const xpathMatch = await findClickableCandidate(
      page,
      loginButtonCandidates.xpath,
      "XPath",
    );
    if (xpathMatch) {
      return xpathMatch;
    }

    const cssMatch = await findClickableCandidate(
      page,
      loginButtonCandidates.css,
      "CSS",
    );
    if (cssMatch) {
      return cssMatch;
    }

    if (discoveryAttempt === 1) {
      console.warn(
        "No clickable login element found. Reloading once before retrying discovery...",
      );
      await captureScreenshot(page, "login-button-not-found-before-reload");
      await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 });
      await waitForPageSettle(page, 10000);
    }
  }

  await dumpHtml(page, "login-button-not-found");
  throw new Error(
    "No visible and clickable login button found with CSS or XPath candidates",
  );
}

async function getLoginModalState(page) {
  return page.evaluate(() => {
    const usernameInput = document.evaluate(
      "//input[@placeholder='Enter your active Email ID / Username']",
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    ).singleNodeValue;
    const passwordInput = document.evaluate(
      "//input[@placeholder='Enter your password']",
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    ).singleNodeValue;
    const submitButton = document.evaluate(
      "//button[text()='Login']",
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    ).singleNodeValue;

    const isVisible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) > 0.01
      );
    };

    return {
      usernameVisible: isVisible(usernameInput),
      passwordVisible: isVisible(passwordInput),
      submitVisible: isVisible(submitButton),
      fullyRendered:
        isVisible(usernameInput) &&
        isVisible(passwordInput) &&
        isVisible(submitButton),
    };
  });
}

async function waitForLoginModal(page, attempt) {
  console.log(`[2/7] Login attempt ${attempt}: waiting for login modal...`);

  try {
    await waitForXPathVisible(page, xpaths.usernameInput, { timeout: 10000 });
    await waitForXPathVisible(page, xpaths.passwordInput, { timeout: 10000 });
    await waitForXPathVisible(page, xpaths.submitButton, { timeout: 10000 });
  } catch (error) {
    await captureScreenshot(page, `login-modal-missing-attempt-${attempt}`);
    await dumpHtml(page, `login-modal-missing-attempt-${attempt}`);
    throw new Error(`Login modal missing or incomplete: ${error.message}`);
  }

  const modalState = await getLoginModalState(page);
  console.log(
    `[2/7] Login attempt ${attempt}: modal visibility state ${JSON.stringify(modalState)}`,
  );

  if (!modalState.fullyRendered) {
    await captureScreenshot(page, `login-modal-incomplete-attempt-${attempt}`);
    await dumpHtml(page, `login-modal-incomplete-attempt-${attempt}`);
    throw new Error(
      "Login modal rendered but required controls are not visible",
    );
  }

  await waitForPageSettle(page, 5000);
  await captureScreenshot(page, `login-modal-opened-attempt-${attempt}`);
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

async function getLoginOutcome(page) {
  return page.evaluate(() => {
    const bodyText = document.body ? document.body.innerText.toLowerCase() : "";
    const currentUrl = window.location.href;
    const hasLoggedInDrawer = Boolean(
      document.querySelector(".nI-gNb-drawer__bars"),
    );
    const hasResumeUploadControl = Boolean(
      document.querySelector("input[value='Update resume']"),
    );
    const hasProfileUrl = /mnjuser\/profile|\/profile/.test(currentUrl);
    const hasProfileText =
      /profile performance|resume headline|update resume|my naukri/.test(
        bodyText,
      );
    const hasCaptcha =
      /captcha|recaptcha|verify you are human|robot/.test(bodyText) ||
      Boolean(
        document.querySelector(
          '[class*="captcha" i], [id*="captcha" i], iframe[src*="captcha" i], iframe[src*="recaptcha" i]',
        ),
      );
    const hasSuspiciousActivity =
      /something went wrong|suspicious activity|temporarily blocked|access denied|try again later/.test(
        bodyText,
      );
    const hasLoginError =
      /invalid|incorrect|wrong password|login failed|please try again/.test(
        bodyText,
      );

    if (hasCaptcha) return { state: "captcha", url: currentUrl };
    if (hasSuspiciousActivity) return { state: "suspicious", url: currentUrl };
    if (hasLoginError) return { state: "error", url: currentUrl };
    if (
      hasLoggedInDrawer ||
      hasResumeUploadControl ||
      hasProfileUrl ||
      hasProfileText
    ) {
      return { state: "success", url: currentUrl };
    }

    return { state: "pending", url: currentUrl };
  });
}

async function waitForLoginOutcome(page, attempt) {
  console.log(
    `[3/7] Login attempt ${attempt}: waiting for post-login outcome...`,
  );

  const waitWindows = [8000, 12000, 15000];
  let lastOutcome = { state: "pending", url: page.url() };

  for (const waitWindow of waitWindows) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < waitWindow) {
      lastOutcome = await getLoginOutcome(page);

      if (lastOutcome.state !== "pending") {
        console.log(
          `[3/7] Login attempt ${attempt}: post-login outcome ${JSON.stringify(lastOutcome)}`,
        );

        if (lastOutcome.state === "success") {
          return lastOutcome;
        }

        await captureScreenshot(
          page,
          `post-login-${lastOutcome.state}-attempt-${attempt}`,
        );
        await dumpHtml(
          page,
          `post-login-${lastOutcome.state}-attempt-${attempt}`,
        );
        throw new Error(
          `Login ${lastOutcome.state} detected at ${lastOutcome.url}`,
        );
      }

      await delay(500);
    }

    console.log(
      `[3/7] Login attempt ${attempt}: still waiting after ${waitWindow}ms at ${lastOutcome.url}`,
    );
    await waitForPageSettle(page, 5000);
  }

  await captureScreenshot(
    page,
    `post-login-validation-timeout-attempt-${attempt}`,
  );
  await dumpHtml(page, `post-login-validation-timeout-attempt-${attempt}`);
  throw new Error(`Post-login validation timed out at ${lastOutcome.url}`);
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
  const loginButton = await findLoginButton(page);
  await clickElementLikeHuman(page, loginButton.element);
  console.log(
    `[2/7] Login attempt ${attempt}: clicked login element via ${loginButton.type} selector ${loginButton.selector}`,
  );
  await waitForLoginModal(page, attempt);

  console.log(`[2/7] Login attempt ${attempt}: entering username...`);
  await typeXPathWithCssFallback(
    page,
    xpaths.usernameInput,
    selectors.usernameInput,
    username,
    "Username input",
  );
  await humanPause(500, 1200);

  console.log(`[2/7] Login attempt ${attempt}: entering password...`);
  await typeXPathWithCssFallback(
    page,
    xpaths.passwordInput,
    selectors.passwordInput,
    password,
    "Password input",
  );
  await humanPause(700, 1500);
  await captureScreenshot(page, `credentials-filled-attempt-${attempt}`);

  console.log(`[2/7] Login attempt ${attempt}: submitting login form...`);
  await captureScreenshot(page, `before-login-click-attempt-${attempt}`);
  const navigationPromise = page
    .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 })
    .catch(() => null);
  await clickXPathWithCssFallback(
    page,
    xpaths.submitButton,
    selectors.submitButton,
    "Login submit button",
  );
  await navigationPromise;
  await waitForPageSettle(page, 10000);
  await captureScreenshot(page, `after-login-click-attempt-${attempt}`);

  console.log(`[3/7] Login attempt ${attempt}: validating post-login state...`);
  const loginOutcome = await waitForLoginOutcome(page, attempt);
  await captureScreenshot(page, `post-login-state-attempt-${attempt}`);
  await detectBlockingSignals(page, `login attempt ${attempt} post-submit`);

  await page
    .waitForSelector(selectors.loggedInDrawer, {
      timeout: 8000,
      visible: true,
    })
    .catch(() =>
      console.warn(
        `[3/7] Login attempt ${attempt}: profile drawer not visible; success inferred from URL/page state`,
      ),
    );
  console.log(`[3/7] Login attempt ${attempt}: login successful`);
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
