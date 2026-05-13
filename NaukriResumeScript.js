const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Optimized delay function (shorter random delays)
const optimizedDelay = (min, max) => 
    new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));

(async () => {
    // const username = process.env.username;
    // const password = process.env.password;

    const username = process.env.NAUKRI_USERNAME;  // ← must match left side above
    const password = process.env.NAUKRI_PASSWORD;  // ← must match left side above
    
    if (!username || !password) {
        console.error("Missing credentials. Set NAUKRI_USERNAME and NAUKRI_PASSWORD environment variables.");
        process.exit(1);
    }
    
    console.log(`Starting resume update process...`);
    
    let browser;
    let page;
    
    try {
        // Launch browser with optimized settings
        browser = await puppeteer.launch({
            headless: 'new', // Set to true for production
            args: [
                '--disable-gpu',
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--window-size=1920,1080'
            ],
            defaultViewport: null
        });
        
        page = await browser.newPage();
        
        // Set user agent without console logging
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        // Step 1: Open Naukri
        console.log('[1/7] Loading Naukri homepage...');
        await page.goto('https://www.naukri.com/', { 
            waitUntil: 'domcontentloaded', // Faster than networkidle
            timeout: 30000 
        });
        await optimizedDelay(1000, 2000);
        
        // Step 2: Login
        console.log('[2/7] Logging in...');
        await page.waitForSelector("a[title='Jobseeker Login']", { timeout: 10000 });
        await page.click("a[title='Jobseeker Login']");
        await optimizedDelay(500, 1000);
        
        await page.waitForSelector("input[placeholder='Enter your active Email ID / Username']", { timeout: 5000 });
        await page.type("input[placeholder='Enter your active Email ID / Username']", username, { delay: 50 });
        await optimizedDelay(500, 1000);
        
        await page.type("input[placeholder='Enter your password']", password, { delay: 50 });
        await optimizedDelay(500, 1000);
        
        await page.click("button[type='submit']");
        
        // Step 3: Verify login
        try {
            await page.waitForSelector('.nI-gNb-drawer__bars', { timeout: 10000 });
            console.log('[3/7] Login successful');
        } catch {
            throw new Error('Login failed');
        }
        
        // Step 4: Navigate to profile (direct URL approach)
        console.log('[4/7] Navigating to profile...');
        await page.goto('https://www.naukri.com/mnjuser/profile', { 
            waitUntil: 'domcontentloaded',
            timeout: 15000 
        });
        
        // Step 5: Update resume
        console.log('[5/7] Updating resume...');
        await page.waitForSelector("input[value='Update resume']", { timeout: 10000 });
        await page.click("input[value='Update resume']");
        await optimizedDelay(1000, 2000);
        
        // Step 6: Upload file
        console.log('[6/7] Uploading resume file...');
        const resumePath = path.join(__dirname, 'utils', 'Kunj_Maheshwari.pdf');
        if (!fs.existsSync(resumePath)) {
            throw new Error(`Resume file not found at: ${resumePath}`);
        }
        
        const fileInput = await page.$("input[type='file']");
        await fileInput.uploadFile(resumePath);
        
        // Wait for upload indicator (but don't block if not found)
        await Promise.race([
            page.waitForSelector('.upload-success', { timeout: 5000 }).catch(() => {}),
            optimizedDelay(3000, 5000)
        ]);
        
        // Step 7: Completion
        console.log('[7/7] Resume update completed successfully');
        console.log(`Resume uploaded at: ${new Date().toLocaleString()}`);
        console.log(`Timestamp: ${Date.now()}`);
        process.exit(0);
        
    } catch (error) {
        console.error(`Error: ${error.message}`);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        if (page) {
            await page.screenshot({ path: `error_${timestamp}.png` });
        }
        process.exit(1);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
})();