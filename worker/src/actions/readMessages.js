import { createBrowser, createContext } from '../browser.js';
import { loadCookies } from '../session.js';
import { delay } from '../humanBehavior.js';
import { checkAndIncrement } from '../rateLimit.js';
import { logMessagesRead } from '../activityLogger.js';
import winston from 'winston';

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [new winston.transports.Console()]
});

/**
 * Read messages action
 * @param {Object} params
 * @returns {Object}
 */
export const readMessages = async ({ accountId, proxyUrl, _jobId }) => {
    let browser, context;
    try {
        await checkAndIncrement(accountId, 'messagesRead');

        const cookies = await loadCookies(accountId);
        if (!cookies) throw new Error('[readMessages] Cookie load failed for ' + accountId);

        browser = await createBrowser(proxyUrl);
        context = await createContext(browser);
        await context.addCookies(cookies);
        const page = await context.newPage();

        await page.goto('https://www.linkedin.com/messaging/');
        await delay(2000, 3000);

        await page.waitForSelector('.msg-conversations-container', { timeout: 15000 });
        const items = await page.$$('.msg-conversation-listitem');

        const conversations = [];
        for (const item of items.slice(0, 20)) {
            const isUnread = await item.evaluate(el => el.classList.contains('msg-conversation-card__unread-count'));
            const participantName = await item.$eval('.msg-conversation-listitem__participant-names', el => el.textContent.trim()).catch(() => '');
            const lastMessagePreview = await item.$eval('.msg-conversation-listitem__message-snippet', el => el.textContent.trim()).catch(() => '');
            const timestamp = await item.$eval('time', el => el.getAttribute('datetime')).catch(() => '');
            const conversationId = await item.evaluate(el => el.getAttribute('data-id') || el.querySelector('a')?.getAttribute('href')).catch(() => '');

            conversations.push({ conversationId, participantName, lastMessagePreview, timestamp, isUnread });
        }

        await logMessagesRead(accountId, conversations.length, _jobId);

        return { accountId, conversations, fetchedAt: new Date().toISOString() };
    } catch (err) {
        logger.error({ msg: 'Read messages failed', accountId, error: err.message });
        throw err;
    } finally {
        if (context) await context.close();
        if (browser) await browser.close();
    }
};
