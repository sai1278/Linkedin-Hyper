import { createBrowser, createContext } from '../browser.js';
import { saveCookies } from '../session.js';
import { delay, humanType, humanClick } from '../humanBehavior.js';
import winston from 'winston';

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [new winston.transports.Console()]
});

/**
 * Perform login action
 * @param {Object} params
 * @returns {Object}
 */
export const login = async ({ accountId, email, password, proxyUrl }) => {
    let browser, context;
    try {
        browser = await createBrowser(proxyUrl);
        context = await createContext(browser);
        const page = await context.newPage();

        await page.goto('https://www.linkedin.com/login');
        await delay(2000, 4000);

        await humanType(page, '#username', email);
        await delay(500, 1200);
        await humanType(page, '#password', password);
        await delay(800, 1500);

        await humanClick(page, '[data-litms-control-urn="login-submit"]');

        // Wait for page to react, then check what LinkedIn shows
        await page.waitForTimeout(3000);

        const captcha = await page.$('#captcha-challenge, iframe[title*="challenge"], .challenge-page');
        if (captcha) {
            throw new Error('CAPTCHA detected — manual intervention required for account: ' + accountId);
        }

        // Only proceed to feed check after confirming no CAPTCHA
        await page.waitForURL('**/feed/**', { timeout: 30000 });

        await saveCookies(accountId, await context.cookies());
        return { success: true, accountId };
    } catch (err) {
        logger.error({ msg: 'Login failed', accountId, error: err.message });
        throw err;
    } finally {
        if (context) await context.close();
        if (browser) await browser.close();
    }
};
