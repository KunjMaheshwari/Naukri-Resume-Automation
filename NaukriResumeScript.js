const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

if (!process.env.NAUKRI_USERNAME || !process.env.NAUKRI_PASSWORD) {
  throw new Error("Missing required environment variables");
}

puppeteer.use(StealthPlugin());

const CONFIG = Object.freeze({
  env: {
    isCI: String(process.env.CI || "").toLowerCase() === "true",
    debugMode: String(process.env.DEBUG_MODE || "").toLowerCase() === "true",
    username: process.env.NAUKRI_USERNAME,
    password: process.env.NAUKRI_PASSWORD,
  },
  urls: {
    home: "https://www.naukri.com/",
    profile: "https://www.naukri.com/mnjuser/profile",
  },
  paths: {
    debugDir: path.join(__dirname, "debug"),
    screenshotDir: path.join(__dirname, "debug", "screenshots"),
    logDir: path.join(__dirname, "debug", "logs"),
    fileDumpDir: path.join(__dirname, "debug", "files"),
    resume: path.join(__dirname, "utils", "Kunj_Maheshwari.pdf"),
  },
  browser: {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: {
      width: 1366,
      height: 768,
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
    },
    launchArgs: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--disable-gpu",
      "--disable-infobars",
      "--disable-notifications",
      "--disable-popup-blocking",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-features=site-per-process,TranslateUI",
      "--lang=en-US,en",
      "--window-size=1366,768",
    ],
  },
  timeouts: {
    navigation: 45000,
    pageReadySoft: 18000,
    pageReadyHard: 55000,
    selector: 18000,
    modal: 22000,
    postLogin: 45000,
    upload: 25000,
  },
  retries: {
    browserLaunch: 2,
    navigation: 2,
    pageReadyRecovery: 1,
    selector: 2,
    interaction: 3,
    login: 2,
  },
  selectors: {
    css: {
      loginTrigger: [
        "a[title='Jobseeker Login']",
        "a.login",
        "button.login",
        "[data-ga-track*='login']",
      ],
      usernameInput:
        "input[placeholder='Enter your active Email ID / Username']",
      passwordInput: "input[placeholder='Enter your password']",
      submitButton: "button[type='submit']",
      profileIcon: ".nI-gNb-drawer__bars",
      updateResumeButton: "input[value='Update resume']",
      fileInput: "input[type='file']",
    },
    xpath: {
      loginTrigger: [
        "//a[@title='Jobseeker Login']",
        "//a[contains(normalize-space(.),'Login')]",
        "//button[contains(normalize-space(.),'Login')]",
      ],
      usernameInput:
        "//input[@placeholder='Enter your active Email ID / Username']",
      passwordInput: "//input[@placeholder='Enter your password']",
      submitButton: "//button[text()='Login']",
    },
    text: {
      login: ["Login", "Jobseeker Login"],
    },
  },
  readiness: {
    minimumHtmlLength: 1200,
    minimumVisibleTextLength: 40,
    appContainerSelectors: [
      "#root",
      "#__next",
      "main",
      "header",
      "nav",
      "[class*='naukri' i]",
      "[class*='gnb' i]",
    ],
    challengePatterns: [
      "captcha",
      "recaptcha",
      "verify you are human",
      "checking your browser",
      "access denied",
      "suspicious activity",
      "temporarily blocked",
      "something went wrong",
      "enable javascript",
    ],
  },
});

function timestamp() {
  return new Date().toISOString();
}

function fileTimestamp() {
  return timestamp().replace(/[:.]/g, "-");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sanitize(value) {
  return String(value)
    .replaceAll(CONFIG.env.username || "__NO_USERNAME__", "[NAUKRI_USERNAME]")
    .replaceAll(CONFIG.env.password || "__NO_PASSWORD__", "[NAUKRI_PASSWORD]");
}

class Logger {
  static log(level, message, meta = {}) {
    const safeMeta = Object.fromEntries(
      Object.entries(meta).map(([key, value]) => [
        key,
        sanitize(JSON.stringify(value)),
      ]),
    );
    const suffix = Object.keys(safeMeta).length
      ? ` ${JSON.stringify(safeMeta)}`
      : "";
    console.log(`[${timestamp()}] [${level}] ${sanitize(message)}${suffix}`);
  }

  static info(message, meta) {
    this.log("INFO", message, meta);
  }

  static warn(message, meta) {
    this.log("WARN", message, meta);
  }

  static error(message, meta) {
    this.log("ERROR", message, meta);
  }
}

class RetryManager {
  static async withRetry(label, fn, options = {}) {
    const attempts = options.attempts || 2;
    const baseDelay = options.baseDelay || 1000;
    const factor = options.factor || 1.8;
    const jitter = options.jitter || 500;
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        Logger.info(`${label}: attempt ${attempt}/${attempts}`);
        return await fn(attempt);
      } catch (error) {
        lastError = error;
        Logger.warn(`${label}: attempt ${attempt} failed`, {
          error: error.message,
        });

        if (attempt === attempts) break;

        const waitMs =
          Math.round(baseDelay * factor ** (attempt - 1)) +
          randomInt(0, jitter);
        Logger.info(`${label}: backing off before retry`, { waitMs });
        await delay(waitMs);
      }
    }

    throw lastError;
  }
}

class DiagnosticsManager {
  constructor(config) {
    this.config = config;
    this.consoleLogPath = path.join(config.paths.logDir, "page-console.ndjson");
    this.networkLogPath = path.join(
      config.paths.logDir,
      "network-events.ndjson",
    );
    this.errorLogPath = path.join(config.paths.logDir, "page-errors.ndjson");
    this.ensureDirs();
  }

  ensureDirs() {
    fs.mkdirSync(this.config.paths.screenshotDir, { recursive: true });
    fs.mkdirSync(this.config.paths.logDir, { recursive: true });
    fs.mkdirSync(this.config.paths.fileDumpDir, { recursive: true });
  }

  appendJson(filePath, payload) {
    fs.appendFileSync(
      filePath,
      `${JSON.stringify({ ts: timestamp(), ...payload })}\n`,
    );
  }

  attachPage(page) {
    page.on("console", (message) => {
      this.appendJson(this.consoleLogPath, {
        type: message.type(),
        text: sanitize(message.text()),
      });
    });

    page.on("pageerror", (error) => {
      this.appendJson(this.errorLogPath, {
        type: "pageerror",
        message: sanitize(error.message),
        stack: sanitize(error.stack || ""),
      });
    });

    page.on("requestfailed", (request) => {
      this.appendJson(this.networkLogPath, {
        type: "requestfailed",
        url: request.url(),
        method: request.method(),
        failure: request.failure()?.errorText || "unknown",
      });
    });

    page.on("response", (response) => {
      if (response.status() >= 400) {
        this.appendJson(this.networkLogPath, {
          type: "http-error",
          status: response.status(),
          url: response.url(),
        });
      }
    });
  }

  async screenshot(page, stage) {
    if (!page) return null;
    const screenshotPath = path.join(
      this.config.paths.screenshotDir,
      `${stage}_${fileTimestamp()}.png`,
    );
    await page
      .screenshot({ path: screenshotPath, fullPage: true })
      .catch((error) => {
        Logger.warn(`Screenshot failed for stage ${stage}`, {
          error: error.message,
        });
      });
    Logger.info("Screenshot captured", { stage, path: screenshotPath });
    return screenshotPath;
  }

  async htmlDump(page, stage) {
    if (!page) return null;
    const htmlPath = path.join(
      this.config.paths.fileDumpDir,
      `${stage}_${fileTimestamp()}.html`,
    );
    const html = await page.content().catch((error) => {
      Logger.warn(`HTML capture failed for stage ${stage}`, {
        error: error.message,
      });
      return "";
    });
    fs.writeFileSync(htmlPath, sanitize(html));
    Logger.info("HTML dump captured", { stage, path: htmlPath });
    return htmlPath;
  }

  async metadata(page, stage, extra = {}) {
    if (!page) return null;
    const metadataPath = path.join(
      this.config.paths.fileDumpDir,
      `${stage}_${fileTimestamp()}.json`,
    );
    const pageState = await page
      .evaluate(() => {
        const bodyText = document.body
          ? document.body.innerText.replace(/\s+/g, " ").trim()
          : "";
        return {
          url: window.location.href,
          title: document.title || "",
          readyState: document.readyState,
          hasBody: Boolean(document.body),
          htmlLength: document.documentElement?.outerHTML?.length || 0,
          visibleTextLength: bodyText.length,
          bodyPreview: bodyText.slice(0, 500),
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio,
          },
        };
      })
      .catch((error) => ({ evaluationError: error.message }));

    fs.writeFileSync(
      metadataPath,
      JSON.stringify({ ts: timestamp(), stage, pageState, extra }, null, 2),
    );
    Logger.info("Debug metadata captured", { stage, path: metadataPath });
    return metadataPath;
  }

  async captureStage(page, stage, extra = {}) {
    await this.screenshot(page, stage);
    await this.metadata(page, stage, extra);
    if (this.config.env.debugMode || extra.includeHtml) {
      await this.htmlDump(page, stage);
    }
  }

  async captureFailure(page, stage, error) {
    Logger.error(`Capturing failure diagnostics for ${stage}`, {
      error: error.message,
    });
    await this.screenshot(page, `${stage}-failure`);
    await this.metadata(page, `${stage}-failure`, {
      includeHtml: true,
      error: error.message,
      stack: error.stack,
    });
    await this.htmlDump(page, `${stage}-failure`);
  }
}

class HumanInteraction {
  static async pause(min = 350, max = 1200) {
    await delay(randomInt(min, max));
  }

  static async moveMouse(page, viewport = CONFIG.browser.viewport) {
    await page.mouse.move(
      randomInt(30, viewport.width - 60),
      randomInt(50, viewport.height - 80),
      {
        steps: randomInt(8, 16),
      },
    );
    await this.pause(120, 320);
    await page.mouse.move(
      randomInt(120, viewport.width - 140),
      randomInt(120, viewport.height - 140),
      { steps: randomInt(14, 28) },
    );
  }

  static async hoverElement(page, element) {
    const box = await element.boundingBox();
    if (!box) return;
    await page.mouse.move(
      box.x + (box.width * randomInt(35, 65)) / 100,
      box.y + (box.height * randomInt(35, 65)) / 100,
      { steps: randomInt(12, 26) },
    );
    await element.hover().catch(() => null);
    await this.pause(120, 350);
  }
}

class BrowserManager {
  constructor(config, diagnostics) {
    this.config = config;
    this.diagnostics = diagnostics;
    this.browser = null;
  }

  launchConfigs() {
    return [
      {
        headless: "new",
        defaultViewport: this.config.browser.viewport,
        args: this.config.browser.launchArgs,
      },
      {
        headless: true,
        defaultViewport: this.config.browser.viewport,
        args: [...this.config.browser.launchArgs, "--single-process"],
      },
    ];
  }

  async launch() {
    this.browser = await RetryManager.withRetry(
      "browser launch",
      async (attempt) => {
        const launchConfig =
          this.launchConfigs()[
            Math.min(attempt - 1, this.launchConfigs().length - 1)
          ];
        Logger.info("Launching Chromium", {
          attempt,
          headless: launchConfig.headless,
          ci: this.config.env.isCI,
        });
        return puppeteer.launch(launchConfig);
      },
      {
        attempts: this.config.retries.browserLaunch,
        baseDelay: 1500,
      },
    );
    this.browser.on("disconnected", () => Logger.warn("Browser disconnected"));
    return this.browser;
  }

  async close() {
    if (this.browser) {
      await this.browser.close().catch((error) => {
        Logger.warn("Browser close failed", { error: error.message });
      });
    }
  }
}

class PageManager {
  constructor(config, diagnostics) {
    this.config = config;
    this.diagnostics = diagnostics;
  }

  async createPage(browser) {
    const page = await browser.newPage();
    this.diagnostics.attachPage(page);
    await this.configurePage(page);
    return page;
  }

  async configurePage(page) {
    page.setDefaultTimeout(this.config.timeouts.selector);
    page.setDefaultNavigationTimeout(this.config.timeouts.navigation);
    await page.setViewport(this.config.browser.viewport);
    await page.setUserAgent(this.config.browser.userAgent);
    await page.setExtraHTTPHeaders({
      "accept-language": "en-US,en;q=0.9",
      "upgrade-insecure-requests": "1",
    });

    try {
      await page.emulateTimezone("Asia/Kolkata");
    } catch (error) {
      Logger.warn("Timezone emulation unavailable", { error: error.message });
    }

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en"],
      });
      Object.defineProperty(navigator, "platform", { get: () => "Win32" });
      Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
      Object.defineProperty(navigator, "deviceMemory", { get: () => 8 });
      Object.defineProperty(navigator, "plugins", {
        get: () => [
          { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer" },
          {
            name: "Chrome PDF Viewer",
            filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai",
          },
          { name: "Native Client", filename: "internal-nacl-plugin" },
        ],
      });

      const originalQuery = window.navigator.permissions?.query;
      if (originalQuery) {
        window.navigator.permissions.query = (parameters) =>
          parameters.name === "notifications"
            ? Promise.resolve({ state: Notification.permission })
            : originalQuery(parameters);
      }

      window.chrome = window.chrome || { runtime: {} };
      window.screen = window.screen || {};
    });

    Logger.info("Page configured", {
      viewport: this.config.browser.viewport,
      ci: this.config.env.isCI,
      debugMode: this.config.env.debugMode,
    });
  }

  async navigate(page, url, stage) {
    return RetryManager.withRetry(
      `${stage} navigation`,
      async () => {
        Logger.info(`${stage}: navigating`, { url });
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: this.config.timeouts.navigation,
        });
        return this.waitForPageReady(page, stage);
      },
      {
        attempts: this.config.retries.navigation,
        baseDelay: 2000,
      },
    );
  }

  async waitForPageReady(page, stage) {
    const startedAt = Date.now();
    let lastState = null;
    let stableLowContentSamples = 0;
    let recoveryUsed = false;

    Logger.info(`${stage}: waiting for page readiness`);

    while (Date.now() - startedAt < this.config.timeouts.pageReadyHard) {
      const state = await this.inspectReadiness(page);
      lastState = state;

      if (this.isChallengeState(state)) {
        await this.diagnostics.captureStage(page, `${stage}-challenge`, {
          includeHtml: true,
          state,
        });
        throw new Error(`${stage}: anti-bot or challenge page detected`);
      }

      if (this.isReadyState(state)) {
        Logger.info(`${stage}: page ready`, state);
        return state;
      }

      if (this.isBlankOrHydrationStalled(state)) {
        stableLowContentSamples += 1;
      } else {
        stableLowContentSamples = 0;
      }

      const elapsed = Date.now() - startedAt;
      if (
        !recoveryUsed &&
        elapsed > this.config.timeouts.pageReadySoft &&
        stableLowContentSamples >= 3
      ) {
        recoveryUsed = true;
        Logger.warn(
          `${stage}: readiness soft timeout reached; reloading once`,
          state,
        );
        await this.diagnostics.captureStage(
          page,
          `${stage}-readiness-recovery`,
          {
            includeHtml: true,
            state,
          },
        );
        await page.reload({
          waitUntil: "domcontentloaded",
          timeout: this.config.timeouts.navigation,
        });
        stableLowContentSamples = 0;
      }

      await delay(this.progressivePollDelay(elapsed));
    }

    await this.diagnostics.captureStage(page, `${stage}-readiness-timeout`, {
      includeHtml: true,
      state: lastState,
    });
    throw new Error(`${stage}: page readiness hard timeout`);
  }

  async inspectReadiness(page) {
    return page.evaluate((readiness) => {
      const html = document.documentElement?.outerHTML || "";
      const bodyText = document.body
        ? document.body.innerText.replace(/\s+/g, " ").trim()
        : "";
      const lowerText = bodyText.toLowerCase();
      const appContainerCount = readiness.appContainerSelectors.filter(
        (selector) => document.querySelector(selector),
      ).length;
      const interactiveCount = document.querySelectorAll(
        "a, button, input, textarea, select, [role='button']",
      ).length;
      const challengeMatches = readiness.challengePatterns.filter((pattern) => {
        const normalizedPattern = pattern.toLowerCase();
        return (
          lowerText.includes(normalizedPattern) ||
          (document.title || "").toLowerCase().includes(normalizedPattern)
        );
      });

      return {
        url: window.location.href,
        title: document.title || "",
        readyState: document.readyState,
        hasBody: Boolean(document.body),
        htmlLength: html.length,
        visibleTextLength: bodyText.length,
        interactiveCount,
        appContainerCount,
        challengeMatches,
        bodyPreview: bodyText.slice(0, 240),
      };
    }, this.config.readiness);
  }

  isReadyState(state) {
    return (
      ["interactive", "complete"].includes(state.readyState) &&
      state.hasBody &&
      state.htmlLength >= this.config.readiness.minimumHtmlLength &&
      (state.visibleTextLength >=
        this.config.readiness.minimumVisibleTextLength ||
        state.interactiveCount >= 5 ||
        state.appContainerCount > 0)
    );
  }

  isBlankOrHydrationStalled(state) {
    return (
      !state.hasBody ||
      state.htmlLength < this.config.readiness.minimumHtmlLength ||
      (state.visibleTextLength < 20 && state.interactiveCount < 3)
    );
  }

  isChallengeState(state) {
    return state.challengeMatches && state.challengeMatches.length > 0;
  }

  progressivePollDelay(elapsed) {
    if (elapsed < 5000) return 350;
    if (elapsed < 15000) return 750;
    return 1250;
  }
}

class SelectorManager {
  constructor(config) {
    this.config = config;
  }

  async findVisibleElement(page, candidates, options = {}) {
    const normalized = Array.isArray(candidates) ? candidates : [candidates];
    const timeout = options.timeout || this.config.timeouts.selector;
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeout) {
      for (const candidate of normalized) {
        const element = await this.findByCandidate(page, candidate);
        if (
          element &&
          (await this.isVisible(element)) &&
          (await this.isClickable(element))
        ) {
          Logger.info("Selector matched", {
            strategy: candidate.strategy,
            value: candidate.value,
          });
          return { element, candidate };
        }
      }
      await delay(options.pollInterval || 350);
    }

    throw new Error(
      `No visible element found for candidates: ${JSON.stringify(normalized)}`,
    );
  }

  async findVisibleXPath(page, xpath, options = {}) {
    return this.findVisibleElement(
      page,
      [{ strategy: "xpath", value: xpath }],
      options,
    );
  }

  async findByCandidate(page, candidate) {
    if (candidate.strategy === "xpath")
      return this.firstXPath(page, candidate.value);
    if (candidate.strategy === "css") return page.$(candidate.value);
    if (candidate.strategy === "text")
      return this.firstTextMatch(page, candidate.value);
    throw new Error(`Unknown selector strategy: ${candidate.strategy}`);
  }

  async firstXPath(page, xpath) {
    const elements = await this.findAllXPath(page, xpath);
    return elements[0] || null;
  }

  async findAllXPath(page, xpath) {
    const handle = await page.evaluateHandle((expression) => {
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

    const properties = await handle.getProperties();
    const elements = [];
    for (const property of properties.values()) {
      const element = property.asElement();
      if (element) elements.push(element);
      else await property.dispose();
    }
    await handle.dispose();
    return elements;
  }

  async firstTextMatch(page, text) {
    const handle = await page.evaluateHandle((expectedText) => {
      const candidates = Array.from(
        document.querySelectorAll("a, button, [role='button']"),
      );
      return (
        candidates.find((node) =>
          (node.innerText || node.textContent || "")
            .trim()
            .toLowerCase()
            .includes(expectedText.toLowerCase()),
        ) || null
      );
    }, text);
    const element = handle.asElement();
    if (!element) await handle.dispose();
    return element;
  }

  async isVisible(element) {
    return element
      .evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) > 0.01
        );
      })
      .catch(() => false);
  }

  async isClickable(element) {
    return element
      .evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        const x = Math.min(
          Math.max(rect.left + rect.width / 2, 0),
          window.innerWidth - 1,
        );
        const y = Math.min(
          Math.max(rect.top + rect.height / 2, 0),
          window.innerHeight - 1,
        );
        const topElement = document.elementFromPoint(x, y);
        return (
          !node.disabled &&
          node.getAttribute("aria-disabled") !== "true" &&
          style.pointerEvents !== "none" &&
          (!topElement || node === topElement || node.contains(topElement))
        );
      })
      .catch(() => false);
  }

  async safeWait(page, candidates, options = {}) {
    return this.findVisibleElement(page, candidates, options);
  }

  async safeClick(page, candidates, options = {}) {
    return RetryManager.withRetry(
      options.label || "safe click",
      async () => {
        const { element, candidate } = await this.findVisibleElement(
          page,
          candidates,
          options,
        );
        await this.scrollIntoView(element);
        await HumanInteraction.hoverElement(page, element);
        await element
          .click({ delay: randomInt(60, 180) })
          .catch(async (error) => {
            Logger.warn("Direct click intercepted; using DOM click fallback", {
              selector: candidate,
              error: error.message,
            });
            await element.evaluate((node) => node.click());
          });
        return { element, candidate };
      },
      {
        attempts: options.attempts || this.config.retries.interaction,
        baseDelay: 600,
      },
    );
  }

  async safeType(page, candidates, value, options = {}) {
    return RetryManager.withRetry(
      options.label || "safe type",
      async () => {
        const { element, candidate } = await this.findVisibleElement(
          page,
          candidates,
          options,
        );
        await this.scrollIntoView(element);
        await HumanInteraction.hoverElement(page, element);
        await element.click({ delay: randomInt(60, 160) });
        await page.keyboard.down(
          process.platform === "darwin" ? "Meta" : "Control",
        );
        await page.keyboard.press("A");
        await page.keyboard.up(
          process.platform === "darwin" ? "Meta" : "Control",
        );
        await page.keyboard.press("Backspace");
        await HumanInteraction.pause(180, 450);

        for (const char of value) {
          await page.keyboard.type(char, { delay: randomInt(55, 155) });
          if (Math.random() < 0.1) await HumanInteraction.pause(120, 360);
        }

        return { element, candidate };
      },
      {
        attempts: options.attempts || this.config.retries.interaction,
        baseDelay: 700,
      },
    );
  }

  async scrollIntoView(element) {
    await element.evaluate((node) => {
      node.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "auto",
      });
    });
    await HumanInteraction.pause(150, 400);
  }
}

class LoginManager {
  constructor(config, pageManager, selectorManager, diagnostics) {
    this.config = config;
    this.pageManager = pageManager;
    this.selectorManager = selectorManager;
    this.diagnostics = diagnostics;
  }

  candidatesForLoginTrigger() {
    return [
      ...this.config.selectors.xpath.loginTrigger.map((value) => ({
        strategy: "xpath",
        value,
      })),
      ...this.config.selectors.css.loginTrigger.map((value) => ({
        strategy: "css",
        value,
      })),
      ...this.config.selectors.text.login.map((value) => ({
        strategy: "text",
        value,
      })),
    ];
  }

  xpathCandidate(value) {
    return [{ strategy: "xpath", value }];
  }

  inputCandidates(xpath, css) {
    return [
      { strategy: "xpath", value: xpath },
      { strategy: "css", value: css },
    ];
  }

  async login(page) {
    return RetryManager.withRetry(
      "login workflow",
      async (attempt) => this.loginAttempt(page, attempt),
      {
        attempts: this.config.retries.login,
        baseDelay: 3000,
      },
    );
  }

  async loginAttempt(page, attempt) {
    Logger.info("Login attempt started", { attempt });
    await this.pageManager.navigate(
      page,
      this.config.urls.home,
      `homepage-attempt-${attempt}`,
    );
    await this.assertNoBlockingSignals(page, `homepage-attempt-${attempt}`);
    await this.diagnostics.captureStage(
      page,
      `homepage-loaded-attempt-${attempt}`,
    );

    await HumanInteraction.moveMouse(page);

    const triggerResult = await this.selectorManager.safeClick(
      page,
      this.candidatesForLoginTrigger(),
      {
        timeout: this.config.timeouts.selector,
        label: "open login modal",
      },
    );
    Logger.info("Login trigger clicked", { selector: triggerResult.candidate });

    await this.waitForLoginModal(page, attempt);
    await this.diagnostics.captureStage(
      page,
      `login-modal-opened-attempt-${attempt}`,
    );

    await this.selectorManager.safeType(
      page,
      this.inputCandidates(
        this.config.selectors.xpath.usernameInput,
        this.config.selectors.css.usernameInput,
      ),
      this.config.env.username,
      { timeout: this.config.timeouts.modal, label: "type username" },
    );
    await HumanInteraction.pause(500, 1200);

    await this.selectorManager.safeType(
      page,
      this.inputCandidates(
        this.config.selectors.xpath.passwordInput,
        this.config.selectors.css.passwordInput,
      ),
      this.config.env.password,
      { timeout: this.config.timeouts.modal, label: "type password" },
    );
    await HumanInteraction.pause(700, 1500);

    await this.validateLoginForm(page);
    await this.diagnostics.captureStage(
      page,
      `credentials-filled-attempt-${attempt}`,
    );
    await this.diagnostics.screenshot(
      page,
      `before-login-click-attempt-${attempt}`,
    );

    const navigationPromise = page
      .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 })
      .catch(() => null);

    const submitResult = await this.selectorManager.safeClick(
      page,
      [
        { strategy: "xpath", value: this.config.selectors.xpath.submitButton },
        { strategy: "css", value: this.config.selectors.css.submitButton },
      ],
      { timeout: this.config.timeouts.modal, label: "submit login" },
    );
    Logger.info("Login submit clicked", { selector: submitResult.candidate });

    await navigationPromise;
    await this.pageManager
      .waitForPageReady(page, `post-login-attempt-${attempt}`)
      .catch((error) => {
        Logger.warn("Post-login page readiness did not fully settle", {
          error: error.message,
        });
      });
    await this.diagnostics.captureStage(
      page,
      `after-login-click-attempt-${attempt}`,
    );

    const outcome = await this.waitForLoginOutcome(page, attempt);
    await this.diagnostics.captureStage(
      page,
      `post-login-state-attempt-${attempt}`,
      { outcome },
    );
    Logger.info("Login successful", { attempt, outcome });
  }

  async waitForLoginModal(page, attempt) {
    Logger.info("Waiting for login modal", { attempt });
    try {
      await this.selectorManager.safeWait(
        page,
        this.xpathCandidate(this.config.selectors.xpath.usernameInput),
        {
          timeout: this.config.timeouts.modal,
        },
      );
      await this.selectorManager.safeWait(
        page,
        this.xpathCandidate(this.config.selectors.xpath.passwordInput),
        {
          timeout: this.config.timeouts.modal,
        },
      );
      await this.selectorManager.safeWait(
        page,
        this.xpathCandidate(this.config.selectors.xpath.submitButton),
        {
          timeout: this.config.timeouts.modal,
        },
      );
    } catch (error) {
      await this.diagnostics.captureFailure(
        page,
        `login-modal-missing-attempt-${attempt}`,
        error,
      );
      throw new Error(`Login modal missing or incomplete: ${error.message}`);
    }

    const state = await this.getLoginModalState(page);
    Logger.info("Login modal visibility state", state);

    if (!state.fullyRendered) {
      const error = new Error(
        "Login modal rendered but required controls are not visible",
      );
      await this.diagnostics.captureFailure(
        page,
        `login-modal-incomplete-attempt-${attempt}`,
        error,
      );
      throw error;
    }
  }

  async getLoginModalState(page) {
    return page.evaluate((xpaths) => {
      const getNode = (expression) =>
        document.evaluate(
          expression,
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
      const username = getNode(xpaths.usernameInput);
      const password = getNode(xpaths.passwordInput);
      const submit = getNode(xpaths.submitButton);
      return {
        usernameVisible: isVisible(username),
        passwordVisible: isVisible(password),
        submitVisible: isVisible(submit),
        fullyRendered:
          isVisible(username) && isVisible(password) && isVisible(submit),
      };
    }, this.config.selectors.xpath);
  }

  async validateLoginForm(page) {
    const state = await page.evaluate((xpaths) => {
      const getValue = (expression) => {
        const node = document.evaluate(
          expression,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null,
        ).singleNodeValue;
        return node ? node.value || "" : "";
      };
      return {
        usernameLength: getValue(xpaths.usernameInput).length,
        passwordLength: getValue(xpaths.passwordInput).length,
      };
    }, this.config.selectors.xpath);

    Logger.info("Login form state validated", {
      usernamePresent: state.usernameLength > 0,
      passwordPresent: state.passwordLength > 0,
    });

    if (state.usernameLength === 0 || state.passwordLength === 0) {
      throw new Error("Login form fields were not populated");
    }
  }

  async assertNoBlockingSignals(page, stage) {
    const outcome = await this.inspectAuthSignals(page);
    if (
      [
        "captcha",
        "suspicious",
        "blocked",
        "otp",
        "challenge",
        "error",
      ].includes(outcome.state)
    ) {
      const error = new Error(`${stage}: ${outcome.state} detected`);
      await this.diagnostics.captureFailure(
        page,
        `${stage}-${outcome.state}`,
        error,
      );
      throw error;
    }
  }

  async waitForLoginOutcome(page, attempt) {
    Logger.info("Waiting for post-login validation", { attempt });
    const startedAt = Date.now();
    let lastOutcome = { state: "pending", url: page.url() };

    while (Date.now() - startedAt < this.config.timeouts.postLogin) {
      lastOutcome = await this.inspectAuthSignals(page);
      if (lastOutcome.state !== "pending") {
        Logger.info("Post-login outcome observed", lastOutcome);

        if (lastOutcome.state === "success") {
          return lastOutcome;
        }

        const error = new Error(
          `Login ${lastOutcome.state} detected at ${lastOutcome.url}`,
        );
        await this.diagnostics.captureFailure(
          page,
          `post-login-${lastOutcome.state}-attempt-${attempt}`,
          error,
        );
        throw error;
      }

      await delay(Date.now() - startedAt < 10000 ? 500 : 1000);
    }

    const error = new Error(
      `Post-login validation timed out at ${lastOutcome.url}`,
    );
    await this.diagnostics.captureFailure(
      page,
      `post-login-timeout-attempt-${attempt}`,
      error,
    );
    throw error;
  }

  async inspectAuthSignals(page) {
    return page.evaluate(() => {
      const bodyText = document.body
        ? document.body.innerText.toLowerCase()
        : "";
      const url = window.location.href;
      const hasProfileIcon = Boolean(
        document.querySelector(".nI-gNb-drawer__bars"),
      );
      const hasResumeControl = Boolean(
        document.querySelector("input[value='Update resume']"),
      );
      const hasProfileUrl = /mnjuser\/profile|\/profile/.test(url);
      const hasProfileText =
        /profile performance|resume headline|update resume|my naukri/.test(
          bodyText,
        );

      if (/captcha|recaptcha|verify you are human|robot/.test(bodyText))
        return { state: "captcha", url };
      if (/otp|one time password|verification code/.test(bodyText))
        return { state: "otp", url };
      if (/checking your browser|enable javascript|challenge/.test(bodyText)) {
        return { state: "challenge", url };
      }
      if (/access denied|temporarily blocked/.test(bodyText))
        return { state: "blocked", url };
      if (
        /something went wrong|suspicious activity|try again later/.test(
          bodyText,
        )
      ) {
        return { state: "suspicious", url };
      }
      if (
        /invalid|incorrect|wrong password|login failed|please try again/.test(
          bodyText,
        )
      ) {
        return { state: "error", url };
      }
      if (
        hasProfileIcon ||
        hasResumeControl ||
        hasProfileUrl ||
        hasProfileText
      ) {
        return { state: "success", url };
      }
      return { state: "pending", url };
    });
  }
}

class ResumeUploadWorkflow {
  constructor(config, pageManager, selectorManager, diagnostics) {
    this.config = config;
    this.pageManager = pageManager;
    this.selectorManager = selectorManager;
    this.diagnostics = diagnostics;
  }

  async upload(page) {
    Logger.info("Navigating to profile for resume upload");
    await this.pageManager.navigate(page, this.config.urls.profile, "profile");
    await this.diagnostics.captureStage(page, "profile-loaded");

    if (!fs.existsSync(this.config.paths.resume)) {
      throw new Error(`Resume file not found at: ${this.config.paths.resume}`);
    }

    await this.selectorManager.safeClick(
      page,
      [
        {
          strategy: "css",
          value: this.config.selectors.css.updateResumeButton,
        },
      ],
      {
        timeout: this.config.timeouts.upload,
        label: "open resume upload control",
      },
    );
    await HumanInteraction.pause(700, 1600);

    await page.waitForFunction(
      (selector) => Boolean(document.querySelector(selector)),
      { timeout: this.config.timeouts.upload },
      this.config.selectors.css.fileInput,
    );
    const fileInput = await page.$(this.config.selectors.css.fileInput);
    if (!fileInput) {
      throw new Error(
        "Resume file input was not found after opening upload control",
      );
    }
    await fileInput.uploadFile(this.config.paths.resume);
    Logger.info("Resume file submitted to upload input");

    await Promise.race([
      page
        .waitForSelector(".upload-success", { timeout: 10000 })
        .catch(() => null),
      delay(8000),
    ]);
    await this.diagnostics.captureStage(page, "resume-upload-submitted");
  }
}

async function main() {
  Logger.info("Starting Naukri resume automation", {
    ci: CONFIG.env.isCI,
    debugMode: CONFIG.env.debugMode,
  });

  const diagnostics = new DiagnosticsManager(CONFIG);
  const browserManager = new BrowserManager(CONFIG, diagnostics);
  const pageManager = new PageManager(CONFIG, diagnostics);
  const selectorManager = new SelectorManager(CONFIG);
  const loginManager = new LoginManager(
    CONFIG,
    pageManager,
    selectorManager,
    diagnostics,
  );
  const uploadWorkflow = new ResumeUploadWorkflow(
    CONFIG,
    pageManager,
    selectorManager,
    diagnostics,
  );

  let page;

  try {
    const browser = await browserManager.launch();
    page = await pageManager.createPage(browser);
    await diagnostics.captureStage(page, "browser-session-created");

    await loginManager.login(page);
    await uploadWorkflow.upload(page);

    Logger.info("Resume update completed successfully", {
      uploadedAt: new Date().toLocaleString(),
      timestamp: Date.now(),
    });
  } catch (error) {
    Logger.error("Automation failed", { error: error.message });
    if (page) {
      await diagnostics.captureFailure(page, "automation", error);
    }
    process.exitCode = 1;
  } finally {
    await browserManager.close();
  }
}

main();
