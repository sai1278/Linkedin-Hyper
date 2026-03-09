import { createBrowser, createContext } from '../browser.js';
import { loadCookies } from '../session.js';
import { checkAndIncrement } from '../rateLimit.js';
import { delay, humanScroll } from '../humanBehavior.js';
import { logProfileViewed } from '../activityLogger.js';
import winston from 'winston';

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [new winston.transports.Console()]
});

export const scrapeProfile = async ({ accountId, profileUrl, proxyUrl, _jobId = 'unknown' }) => {
    let browser, context;
    try {
        await checkAndIncrement(accountId, 'profileView');
        const cookies = await loadCookies(accountId);
        if (!cookies) throw new Error('[scrapeProfile] Cookie load failed for ' + accountId);

        browser = await createBrowser(proxyUrl);
        context = await createContext(browser);
        await context.addCookies(cookies);
        const page = await context.newPage();

        await page.goto(profileUrl);
        await delay(2000, 4000);
        await humanScroll(page, 400);

        const name = await page.$eval('.text-heading-xlarge', el => el.textContent.trim()).catch(() => '');
        const headline = await page.$eval('.text-body-medium.break-words', el => el.textContent.trim()).catch(() => '');
        const location = await page.$eval('.text-body-small.inline.t-black--light.break-words', el => el.textContent.trim()).catch(() => '');
        const about = await page.$eval('#about ~ div .visually-hidden, section[data-section="summary"]', el => el.textContent.trim()).catch(() => '');
        const company = await page.$eval('.inline-show-more-text--is-collapsed', el => el.textContent.trim()).catch(() => '');

        await logProfileViewed(accountId, profileUrl, _jobId);
        return {
            accountId,
            profileUrl,
            data: { name, headline, location, about, company },
            scrapedAt: new Date().toISOString()
        };
    } catch (err) {
        logger.error({ msg: 'Scrape profile failed', accountId, error: err.message });
        throw err;
    } finally {
        if (context) await context.close();
        if (browser) await browser.close();
    }
};
