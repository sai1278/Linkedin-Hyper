import { createBrowser, createContext } from '../browser.js';
import { loadCookies, saveCookies } from '../session.js';
import { checkAndIncrement } from '../rateLimit.js';
import { delay, humanType, humanClick } from '../humanBehavior.js';
import { logMessageSent } from '../activityLogger.js';
import winston from 'winston';

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [new winston.transports.Console()]
});

export const sendMessage = async ({ accountId, recipientProfileUrl, message, proxyUrl, _jobId = 'unknown' }) => {
    let browser, context;
    try {
        await checkAndIncrement(accountId, 'messagesSent');
        const cookies = await loadCookies(accountId);
        if (!cookies) throw new Error('[sendMessage] Cookie load failed for ' + accountId);

        browser = await createBrowser(proxyUrl);
        context = await createContext(browser);
        await context.addCookies(cookies);
        const page = await context.newPage();

        await page.goto(recipientProfileUrl);
        await delay(2000, 4000);
        await humanClick(page, 'button[aria-label*="Message"]');
        await delay(1500, 3000);
        await humanType(page, '.msg-form__contenteditable', message);
        await delay(800, 2000);
        await humanClick(page, '.msg-form__send-button');
        await delay(1000, 2000);
        await saveCookies(accountId, await context.cookies());
        await logMessageSent(accountId, recipientProfileUrl, message, _jobId);

        return { success: true, accountId, recipientProfileUrl };
    } catch (err) {
        logger.error({ msg: 'Send message failed', accountId, error: err.message });
        throw err;
    } finally {
        if (context) await context.close();
        if (browser) await browser.close();
    }
};
