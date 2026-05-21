const plainPuppeteer = require("puppeteer");
const puppeteerExtra = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

if (!process.env.NAUKRI_USERNAME || !process.env.NAUKRI_PASSWORD) {
  throw new Error("Missing required environment variables");
}

const CONFIG = Object.freeze({
  env: {
    isCI: String(process.env.CI || "").toLowerCase() === "true",
    debugMode: String(process.env.DEBUG_MODE || "").toLowerCase() === "true",
    debugCompareModes:
      String(process.env.DEBUG_COMPARE_MODES || "").toLowerCase() === "true",
    hardeningMode: process.env.BROWSER_HARDENING_MODE || "balanced",
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
    localHeadless:
      String(
        process.env.HEADLESS || process.env.LOCAL_HEADLESS || "false",
      ).toLowerCase() === "true",
    baselineLaunchArgs: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--window-size=1366,768",
    ],
    balancedLaunchArgs: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-notifications",
      "--disable-popup-blocking",
      "--lang=en-US,en",
      "--window-size=1366,768",
    ],
    aggressiveLaunchArgs: [
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
  },
  timeouts: {
    navigation: 45000,
    hydration: 90000,
    selector: 18000,
    modal: 22000,
    postLogin: 45000,
    upload: 25000,
  },
  retries: {
    browserLaunch: 2,
    navigation: 2,
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
    minimumVisibleTextLength: 300,
    minimumInteractiveCount: 5,
    renderedUiText: [
      "Find your dream job now",
      "Register",
      "Login",
      "Search jobs",
      "Jobs",
    ],
    searchPlaceholders: [
      "Enter skills / designations / companies",
      "Enter location",
      "Search jobs here",
    ],
    blockedText: [
      "Access Denied",
      "Forbidden",
      "Request blocked",
      "Checking your browser",
      "Please wait",
      "captcha",
      "recaptcha",
      "verify you are human",
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

class BrowserProfileFactory {
  static profiles(config) {
    return {
      minimal: {
        name: "minimal",
        puppeteer: plainPuppeteer,
        useStealth: false,
        launchArgs: config.browser.baselineLaunchArgs,
        applyHeaders: false,
        applyTimezone: false,
        overrideLevel: "none",
      },
      balanced: {
        name: "balanced",
        puppeteer: plainPuppeteer,
        useStealth: false,
        launchArgs: config.browser.balancedLaunchArgs,
        applyHeaders: true,
        applyTimezone: true,
        overrideLevel: "none",
      },
      aggressive: {
        name: "aggressive",
        puppeteer: puppeteerExtra,
        useStealth: true,
        launchArgs: config.browser.aggressiveLaunchArgs,
        applyHeaders: true,
        applyTimezone: true,
        overrideLevel: "navigator",
      },
    };
  }

  static comparisonProfiles(config) {
    return [
      {
        name: "baseline-plain",
        puppeteer: plainPuppeteer,
        useStealth: false,
        launchArgs: config.browser.baselineLaunchArgs,
        applyHeaders: false,
        applyTimezone: false,
        overrideLevel: "none",
      },
      {
        name: "launch-args-only",
        puppeteer: plainPuppeteer,
        useStealth: false,
        launchArgs: config.browser.balancedLaunchArgs,
        applyHeaders: true,
        applyTimezone: true,
        overrideLevel: "none",
      },
      {
        name: "stealth-plugin-only",
        puppeteer: puppeteerExtra,
        useStealth: true,
        launchArgs: config.browser.baselineLaunchArgs,
        applyHeaders: false,
        applyTimezone: false,
        overrideLevel: "none",
      },
      {
        name: "navigator-overrides",
        puppeteer: plainPuppeteer,
        useStealth: false,
        launchArgs: config.browser.balancedLaunchArgs,
        applyHeaders: true,
        applyTimezone: true,
        overrideLevel: "navigator",
      },
      {
        name: "permissions-overrides",
        puppeteer: plainPuppeteer,
        useStealth: false,
        launchArgs: config.browser.balancedLaunchArgs,
        applyHeaders: true,
        applyTimezone: true,
        overrideLevel: "permissions",
      },
      {
        name: "advanced-fingerprint",
        puppeteer: puppeteerExtra,
        useStealth: true,
        launchArgs: config.browser.aggressiveLaunchArgs,
        applyHeaders: true,
        applyTimezone: true,
        overrideLevel: "advanced",
      },
    ];
  }

  static select(config) {
    const profiles = this.profiles(config);
    const selected = profiles[config.env.hardeningMode] || profiles.balanced;
    if (selected.useStealth) {
      this.ensureStealthPlugin();
    }
    return selected;
  }

  static ensureStealthPlugin() {
    if (!this.stealthRegistered) {
      puppeteerExtra.use(StealthPlugin());
      this.stealthRegistered = true;
    }
  }
}

class BrowserManager {
  constructor(config, diagnostics) {
    this.config = config;
    this.diagnostics = diagnostics;
    this.browser = null;
    this.profile = BrowserProfileFactory.select(config);
  }

  launchConfigs() {
    const shouldRunHeadless = this.config.env.isCI
      ? "new"
      : this.config.browser.localHeadless
        ? "new"
        : false;

    return [
      {
        headless: shouldRunHeadless,
        slowMo: shouldRunHeadless === false ? 80 : undefined,
        defaultViewport: this.config.browser.viewport,
        args: this.profile.launchArgs,
      },
      {
        headless: true,
        defaultViewport: this.config.browser.viewport,
        args: [...this.profile.launchArgs, "--single-process"],
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
          hardeningMode: this.profile.name,
          stealth: this.profile.useStealth,
          headless: launchConfig.headless,
          ci: this.config.env.isCI,
        });
        return this.profile.puppeteer.launch(launchConfig);
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
  constructor(
    config,
    diagnostics,
    browserProfile = BrowserProfileFactory.select(config),
  ) {
    this.config = config;
    this.diagnostics = diagnostics;
    this.browserProfile = browserProfile;
  }

  async createPage(browser) {
    const page = await browser.newPage();
    this.diagnostics.attachPage(page);
    await this.configurePage(page);
    return page;
  }

  async configurePage(page) {
    if (typeof page.waitForTimeout !== "function") {
      page.waitForTimeout = (milliseconds) => delay(milliseconds);
    }

    page.setDefaultTimeout(this.config.timeouts.selector);
    page.setDefaultNavigationTimeout(this.config.timeouts.navigation);
    await page.setViewport(this.config.browser.viewport);
    if (this.browserProfile.applyHeaders) {
      await page.setUserAgent(this.config.browser.userAgent);
      await page.setExtraHTTPHeaders({
        "accept-language": "en-US,en;q=0.9",
        "upgrade-insecure-requests": "1",
      });
    }

    if (this.browserProfile.applyTimezone) {
      try {
        await page.emulateTimezone("Asia/Kolkata");
      } catch (error) {
        Logger.warn("Timezone emulation unavailable", { error: error.message });
      }
    }

    await this.applyProgressiveOverrides(page);

    await page.setCacheEnabled(true);

    Logger.info("Page configured", {
      viewport: this.config.browser.viewport,
      hardeningMode: this.browserProfile.name,
      overrideLevel: this.browserProfile.overrideLevel,
      stealth: this.browserProfile.useStealth,
      ci: this.config.env.isCI,
      debugMode: this.config.env.debugMode,
    });
  }

  async applyProgressiveOverrides(page) {
    const level = this.browserProfile.overrideLevel;
    if (level === "none") return;

    // Safe policy: do not spoof window.chrome, plugins, permissions,
    // hardwareConcurrency, or deviceMemory in the stable balanced profile.
    if (
      level === "navigator" ||
      level === "permissions" ||
      level === "advanced"
    ) {
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
        Object.defineProperty(navigator, "languages", {
          get: () => ["en-US", "en"],
        });
        Object.defineProperty(navigator, "platform", { get: () => "Win32" });
      });
    }

    if (level === "permissions" || level === "advanced") {
      await page.evaluateOnNewDocument(() => {
        const originalQuery = window.navigator.permissions?.query;
        if (originalQuery) {
          window.navigator.permissions.query = (parameters) =>
            parameters.name === "notifications"
              ? Promise.resolve({ state: Notification.permission })
              : originalQuery(parameters);
        }
      });
    }

    if (level === "advanced") {
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "hardwareConcurrency", {
          get: () => 8,
        });
        Object.defineProperty(navigator, "deviceMemory", { get: () => 8 });
        Object.defineProperty(navigator, "plugins", {
          get: () => [
            { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer" },
            {
              name: "Chrome PDF Viewer",
              filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai",
            },
          ],
        });
      });
    }
  }

  async navigate(page, url, stage, hydrationOptions = {}) {
    await RetryManager.withRetry(
      `${stage} navigation`,
      async () => {
        Logger.info(`${stage}: navigating`, { url });
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: this.config.timeouts.navigation,
        });
      },
      {
        attempts: this.config.retries.navigation,
        baseDelay: 2000,
      },
    );

    await page.waitForTimeout(5000);
    return this.waitForHydratedUIWithRecovery(page, stage, hydrationOptions);
  }

  async waitForHydratedUIWithRecovery(page, stage, hydrationOptions = {}) {
    try {
      return await this.waitForHydratedUI(page, stage, hydrationOptions);
    } catch (error) {
      Logger.warn(`${stage}: hydration validation failed; reloading once`, {
        error: error.message,
      });
      await this.diagnostics.captureStage(
        page,
        `${stage}-hydration-before-reload`,
        {
          includeHtml: true,
          error: error.message,
        },
      );
      await page.waitForTimeout(10000);
      await page.reload({
        waitUntil: "domcontentloaded",
        timeout: this.config.timeouts.navigation,
      });
      await page.waitForTimeout(5000);
      return this.waitForHydratedUI(page, `${stage}-reload`, hydrationOptions);
    }
  }

  async waitForHydratedUI(page, stage = "page", hydrationOptions = {}) {
    const startedAt = Date.now();
    let lastState = null;

    Logger.info(`${stage}: waiting for hydrated Naukri UI`);

    while (Date.now() - startedAt < this.config.timeouts.hydration) {
      const state = await this.collectHydrationMetrics(page, hydrationOptions);
      lastState = state;

      if (state.hydrated) {
        Logger.info(`${stage}: hydrated UI detected`, state);
        return state;
      }

      Logger.info(`${stage}: hydration pending`, {
        elapsedMs: Date.now() - startedAt,
        readyState: state.readyState,
        titleLength: state.title.length,
        visibleTextLength: state.visibleTextLength,
        interactiveCount: state.interactiveCount,
        renderedUiFound: state.renderedUiFound,
        blockedTextFound: state.blockedTextFound,
        url: state.url,
      });

      await page.waitForTimeout(1000);
    }

    await this.diagnostics.captureStage(page, `${stage}-hydration-timeout`, {
      includeHtml: true,
      state: lastState,
    });
    throw new Error(
      `${stage}: hydrated UI timeout after ${this.config.timeouts.hydration}ms`,
    );
  }

  async collectHydrationMetrics(page, hydrationOptions = {}) {
    const readiness = {
      ...this.config.readiness,
      ...hydrationOptions,
      renderedUiText:
        hydrationOptions.renderedUiText || this.config.readiness.renderedUiText,
      searchPlaceholders:
        hydrationOptions.searchPlaceholders ||
        this.config.readiness.searchPlaceholders,
    };

    return page.evaluate((readiness) => {
      const bodyText = document.body
        ? document.body.innerText.replace(/\s+/g, " ").trim()
        : "";
      const normalizedBodyText = bodyText.toLowerCase();
      const interactiveCount =
        document.querySelectorAll("button, a, input").length;
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
      const visibleLoginButton = isVisible(
        document.evaluate(
          "//a[@title='Jobseeker Login'] | //a[contains(normalize-space(.),'Login')] | //button[contains(normalize-space(.),'Login')]",
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null,
        ).singleNodeValue,
      );
      const visibleRegisterButton = Array.from(
        document.querySelectorAll("a, button"),
      ).some(
        (node) =>
          isVisible(node) &&
          /register/i.test(node.innerText || node.textContent || ""),
      );
      const visibleRequiredText = readiness.renderedUiText.some((text) =>
        bodyText.includes(text),
      );
      const visibleSearchPlaceholder = Array.from(
        document.querySelectorAll("input, textarea"),
      ).some(
        (node) =>
          isVisible(node) &&
          readiness.searchPlaceholders.some((placeholder) =>
            String(node.getAttribute("placeholder") || "").includes(
              placeholder,
            ),
          ),
      );
      const blockedMatches = readiness.blockedText.filter((text) =>
        normalizedBodyText.includes(text.toLowerCase()),
      );
      const renderedUiFound =
        visibleLoginButton ||
        visibleRegisterButton ||
        visibleRequiredText ||
        visibleSearchPlaceholder;

      const metrics = {
        url: window.location.href,
        title: document.title || "",
        readyState: document.readyState,
        hasBody: Boolean(document.body),
        visibleTextLength: bodyText.length,
        interactiveCount,
        renderedUiFound,
        visibleLoginButton,
        visibleRegisterButton,
        visibleRequiredText,
        visibleSearchPlaceholder,
        blockedTextFound: blockedMatches.length > 0,
        blockedMatches,
        bodyPreview: bodyText.slice(0, 1000),
      };

      return {
        ...metrics,
        hydrated:
          metrics.readyState !== "loading" &&
          metrics.title.length > 0 &&
          metrics.visibleTextLength > readiness.minimumVisibleTextLength &&
          metrics.interactiveCount >= readiness.minimumInteractiveCount &&
          metrics.renderedUiFound &&
          !metrics.blockedTextFound,
      };
    }, readiness);
  }

  async logVisibleDebugState(page, stage) {
    const state = await this.collectHydrationMetrics(page);
    Logger.info(`${stage}: visible rendered state before selector detection`, {
      url: state.url,
      title: state.title,
      visibleTextLength: state.visibleTextLength,
      interactiveCount: state.interactiveCount,
      renderedUiFound: state.renderedUiFound,
      blockedMatches: state.blockedMatches,
      bodyPreview: state.bodyPreview,
    });
    await this.diagnostics.screenshot(
      page,
      `${stage}-before-selector-detection`,
    );
    return state;
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
    await this.pageManager.logVisibleDebugState(
      page,
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
      .waitForHydratedUI(page, `post-login-attempt-${attempt}`)
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
    await this.pageManager.navigate(page, this.config.urls.profile, "profile", {
      renderedUiText: [
        "Update resume",
        "Resume headline",
        "Profile",
        "My Naukri",
        "Jobs",
      ],
      searchPlaceholders: this.config.readiness.searchPlaceholders,
    });
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

class HardeningComparisonRunner {
  constructor(config, diagnostics) {
    this.config = config;
    this.diagnostics = diagnostics;
  }

  async run() {
    Logger.info("DEBUG_COMPARE_MODES enabled; starting hardening comparison");
    const results = [];

    for (const profile of BrowserProfileFactory.comparisonProfiles(
      this.config,
    )) {
      if (profile.useStealth) {
        BrowserProfileFactory.ensureStealthPlugin();
      }

      const result = await this.runProfile(profile);
      results.push(result);
      Logger.info("Hardening comparison profile result", {
        profile: result.profile,
        hydrationSucceeded: result.hydrationSucceeded,
        title: result.state?.title,
        readyState: result.state?.readyState,
        visibleTextLength: result.state?.visibleTextLength,
        interactiveCount: result.state?.interactiveCount,
        renderedUiFound: result.state?.renderedUiFound,
        error: result.error,
      });
    }

    const summaryPath = path.join(
      this.config.paths.fileDumpDir,
      `hardening-comparison_${fileTimestamp()}.json`,
    );
    fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2));
    Logger.info("Hardening comparison completed", {
      summaryPath,
      likelyBreakingProfile: this.findLikelyBreakingProfile(results),
    });
  }

  async runProfile(profile) {
    let browser;
    let page;
    const startedAt = Date.now();

    try {
      Logger.info("Comparison profile starting", {
        profile: profile.name,
        stealth: profile.useStealth,
        overrideLevel: profile.overrideLevel,
      });
      browser = await profile.puppeteer.launch({
        headless: "new",
        defaultViewport: this.config.browser.viewport,
        args: profile.launchArgs,
      });
      page = await browser.newPage();
      this.diagnostics.attachPage(page);

      const profilePageManager = new PageManager(
        this.config,
        this.diagnostics,
        profile,
      );
      await profilePageManager.configurePage(page);
      await page.goto(this.config.urls.home, {
        waitUntil: "domcontentloaded",
        timeout: this.config.timeouts.navigation,
      });

      let state;
      let hydrationSucceeded = false;
      try {
        await page.waitForTimeout(5000);
        state = await profilePageManager.waitForHydratedUI(
          page,
          `compare-${profile.name}`,
        );
        hydrationSucceeded = true;
      } catch (error) {
        state = await profilePageManager
          .collectHydrationMetrics(page)
          .catch((inspectError) => ({
            inspectError: inspectError.message,
          }));
        Logger.warn("Comparison profile failed hydration", {
          profile: profile.name,
          error: error.message,
          state,
        });
      }

      await this.diagnostics.captureStage(page, `compare-${profile.name}`, {
        profile: profile.name,
        state,
      });

      return {
        profile: profile.name,
        stealth: profile.useStealth,
        overrideLevel: profile.overrideLevel,
        launchArgs: profile.launchArgs,
        hydrationSucceeded,
        elapsedMs: Date.now() - startedAt,
        state,
      };
    } catch (error) {
      Logger.warn("Comparison profile crashed", {
        profile: profile.name,
        error: error.message,
      });
      if (page) {
        await this.diagnostics.captureFailure(
          page,
          `compare-${profile.name}`,
          error,
        );
      }
      return {
        profile: profile.name,
        stealth: profile.useStealth,
        overrideLevel: profile.overrideLevel,
        launchArgs: profile.launchArgs,
        hydrationSucceeded: false,
        elapsedMs: Date.now() - startedAt,
        error: error.message,
      };
    } finally {
      if (browser) {
        await browser.close().catch((error) => {
          Logger.warn("Comparison browser close failed", {
            profile: profile.name,
            error: error.message,
          });
        });
      }
    }
  }

  findLikelyBreakingProfile(results) {
    const firstSuccessIndex = results.findIndex(
      (result) => result.hydrationSucceeded,
    );
    const firstFailureAfterSuccess = results.find(
      (result, index) =>
        firstSuccessIndex !== -1 &&
        index > firstSuccessIndex &&
        !result.hydrationSucceeded,
    );
    return firstFailureAfterSuccess?.profile || "not-isolated";
  }
}

async function main() {
  Logger.info("Starting Naukri resume automation", {
    ci: CONFIG.env.isCI,
    debugMode: CONFIG.env.debugMode,
    debugCompareModes: CONFIG.env.debugCompareModes,
    hardeningMode: CONFIG.env.hardeningMode,
  });

  const diagnostics = new DiagnosticsManager(CONFIG);
  if (CONFIG.env.debugCompareModes) {
    await new HardeningComparisonRunner(CONFIG, diagnostics).run();
  }

  const browserManager = new BrowserManager(CONFIG, diagnostics);
  const pageManager = new PageManager(
    CONFIG,
    diagnostics,
    browserManager.profile,
  );
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
    Logger.info("Execution mode", {
      localHeadless: CONFIG.browser.localHeadless,
      ci: CONFIG.env.isCI,
      hardeningMode: CONFIG.env.hardeningMode,
    });
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

main().catch((error) => {
  Logger.error("Unhandled fatal error", {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});
