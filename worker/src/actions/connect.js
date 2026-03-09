import { createBrowser, createContext } from '../browser.js';
import { loadCookies, saveCookies } from '../session.js';
import { checkAndIncrement } from '../rateLimit.js';
import { delay, humanClick, humanType } from '../humanBehavior.js';
import { generateConnectionNote } from '../promptGenerator.js';
import { logConnectionSent } from '../activityLogger.js';
import winston from 'winston';

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [new winston.transports.Console()]
});

export const sendConnectionRequest = async ({ accountId, profileUrl, note, recipientName = '', senderName = '', topic = '', proxyUrl, _jobId = 'unknown' }) => {
    let browser, context;
    try {
        await checkAndIncrement(accountId, 'connectRequests');
        const cookies = await loadCookies(accountId);
        if (!cookies) throw new Error('[sendConnectionRequest] Cookie load failed for ' + accountId);

        browser = await createBrowser(proxyUrl);
        context = await createContext(browser);
        await context.addCookies(cookies);
        const page = await context.newPage();

        await page.goto(profileUrl);
        await delay(2000, 4000);
        await humanClick(page, 'button[aria-label*="Connect"]');
        await delay(1000, 2000);

        const resolvedNote = note || generateConnectionNote({ recipientName, senderName, topic });

        if (resolvedNote) {
            await humanClick(page, 'button[aria-label="Add a note"]');
            await delay(500, 1000);
            await humanType(page, 'textarea#custom-message', resolvedNote.substring(0, 300));
        }

        try {
            await humanClick(page, 'button[aria-label="Send now"]');
        } catch {
            await humanClick(page, 'button[aria-label="Send invitation"]');
        }
        await delay(1000, 2000);
        await page.reload();
        await saveCookies(accountId, await context.cookies());
        await logConnectionSent(accountId, profileUrl, resolvedNote, _jobId);
        return { success: true, accountId, profileUrl };
    } catch (err) {
        logger.error({ msg: 'Connect failed', accountId, error: err.message });
        throw err;
    } finally {
        if (context) await context.close();
        if (browser) await browser.close();
    }
};
