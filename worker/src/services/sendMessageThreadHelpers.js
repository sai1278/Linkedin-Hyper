'use strict';

function createSendMessageThreadHelpers(deps) {
  const {
    delay,
    normalizeText,
    slugToName,
    normalizeProfileUrlForCompare,
    gotoMessagingHomeLenient,
    logSendStep,
    truncateForLog,
  } = deps;

  function normalizeThreadIdCandidate(value) {
    return String(value || '').trim();
  }

  function isValidThreadId(value) {
    const id = normalizeThreadIdCandidate(value);
    if (!id) return false;
    if (id.toLowerCase() === 'new') return false;
    return true;
  }

  function extractThreadIdFromText(value) {
    const raw = String(value || '');
    if (!raw) return '';

    const fromThreadUrl = raw.match(/\/messaging\/thread\/([^/?#"\s]+)/i);
    if (isValidThreadId(fromThreadUrl?.[1])) return normalizeThreadIdCandidate(fromThreadUrl[1]);

    const fromUrn = raw.match(/fs(?:d)?_conversation:([^,"\s)]+)/i);
    if (isValidThreadId(fromUrn?.[1])) return normalizeThreadIdCandidate(fromUrn[1]);

    const fromQuery = raw.match(/[?&](?:conversationId|threadId)=([^&#"\s]+)/i);
    if (fromQuery?.[1]) {
      try {
        const decoded = decodeURIComponent(fromQuery[1]);
        if (isValidThreadId(decoded)) return normalizeThreadIdCandidate(decoded);
      } catch {
        if (isValidThreadId(fromQuery[1])) return normalizeThreadIdCandidate(fromQuery[1]);
      }
    }

    const fromConversationUrn = raw.match(/conversationUrn=([^&#"\s]+)/i);
    if (fromConversationUrn?.[1]) {
      try {
        const decoded = decodeURIComponent(fromConversationUrn[1]);
        const decodedUrn = decoded.match(/fs(?:d)?_conversation:([^,"\s)]+)/i);
        if (isValidThreadId(decodedUrn?.[1])) return normalizeThreadIdCandidate(decodedUrn[1]);
      } catch {}
    }

    return '';
  }

  function createNetworkThreadIdProbe(page) {
    let resolvedThreadId = '';
    const pendingParsers = new Set();

    const maybeResolve = (candidate) => {
      if (!resolvedThreadId && isValidThreadId(candidate)) {
        resolvedThreadId = normalizeThreadIdCandidate(candidate);
      }
    };

    const inspectResponse = (response) => {
      if (resolvedThreadId) return;

      try {
        const url = response.url() || '';
        if (!/linkedin\.com/i.test(url) || !/messaging|voyager/i.test(url)) {
          return;
        }

        const idFromUrl = extractThreadIdFromText(url);
        if (idFromUrl) {
          maybeResolve(idFromUrl);
          return;
        }

        const parser = (async () => {
          try {
            const body = await response.text();
            const idFromBody = extractThreadIdFromText(body);
            if (idFromBody) maybeResolve(idFromBody);
          } catch (_) {}
        })();

        pendingParsers.add(parser);
        parser.finally(() => pendingParsers.delete(parser));
      } catch (_) {}
    };

    const inspectRequest = (request) => {
      if (resolvedThreadId) return;
      try {
        const url = request.url() || '';
        if (!/linkedin\.com/i.test(url) || !/messaging|voyager/i.test(url)) {
          return;
        }

        const idFromUrl = extractThreadIdFromText(url);
        if (idFromUrl) {
          maybeResolve(idFromUrl);
          return;
        }

        const postData = request.postData?.() || '';
        const idFromBody = extractThreadIdFromText(postData);
        if (idFromBody) {
          maybeResolve(idFromBody);
        }
      } catch (_) {}
    };

    page.on('request', inspectRequest);
    page.on('response', inspectResponse);

    return {
      async waitForThreadId(waitMs = 12000) {
        const deadline = Date.now() + waitMs;
        while (!resolvedThreadId && Date.now() < deadline) {
          if (pendingParsers.size > 0) {
            await Promise.race([
              Promise.allSettled(Array.from(pendingParsers)),
              delay(180, 260),
            ]);
          } else {
            await delay(180, 260);
          }
        }

        if (!resolvedThreadId && pendingParsers.size > 0) {
          await Promise.allSettled(Array.from(pendingParsers));
        }

        return resolvedThreadId;
      },
      stop() {
        page.off('request', inspectRequest);
        page.off('response', inspectResponse);
      },
    };
  }

  async function getMessageSnapshot(page) {
    return page.evaluate(() => {
      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const nodes = Array.from(
        document.querySelectorAll(
          [
            '.msg-s-message-list__event--own-turn .msg-s-event__content',
            '[data-view-name="messaging-self-message"] .msg-s-event__content',
            '.msg-s-event-listitem .msg-s-event__content',
            '[data-view-name="messaging-message-list-item"] .msg-s-event__content',
            '.msg-s-event__content',
          ].join(', ')
        )
      );
      const texts = nodes.map((node) => normalize(node?.textContent)).filter(Boolean);
      return {
        count: texts.length,
        lastText: texts.length > 0 ? texts[texts.length - 1] : '',
        recentTexts: texts.slice(-30),
      };
    });
  }

  async function verifyMessageEcho(page, text, beforeSnapshot, timeoutMs = 12000) {
    const target = normalizeText(text);
    if (!target) return false;
    const beforeCount = Number(beforeSnapshot?.count || 0);
    const beforeLastText = normalizeText(beforeSnapshot?.lastText);
    const beforeRecentTexts = Array.isArray(beforeSnapshot?.recentTexts)
      ? beforeSnapshot.recentTexts.map((item) => normalizeText(item)).filter(Boolean)
      : [];

    try {
      await page.waitForFunction(
        (needle, oldCount, oldLastText, oldRecentTexts) => {
          const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
          const nodes = Array.from(
            document.querySelectorAll(
              [
                '.msg-s-message-list__event--own-turn .msg-s-event__content',
                '[data-view-name="messaging-self-message"] .msg-s-event__content',
                '.msg-s-event-listitem .msg-s-event__content',
                '[data-view-name="messaging-message-list-item"] .msg-s-event__content',
                '.msg-s-event__content',
              ].join(', ')
            )
          );
          const texts = nodes.map((node) => normalize(node?.textContent)).filter(Boolean);
          if (texts.length === 0) return false;

          const oldRecent = Array.isArray(oldRecentTexts) ? oldRecentTexts.map((item) => normalize(item)) : [];
          const oldRecentSet = new Set(oldRecent);
          const lastOwnText = normalize(texts[texts.length - 1]);
          const normalizedNeedle = normalize(needle);
          const matchingTexts = texts.filter((item) =>
            item.includes(normalizedNeedle) || normalizedNeedle.includes(item)
          );
          if (matchingTexts.length === 0) return false;

          const hasNewMatchingText = matchingTexts.some((item) => !oldRecentSet.has(item));
          const countIncreased = texts.length > Number(oldCount || 0);
          const changedFromPrevious = lastOwnText !== normalize(oldLastText || '');

          return hasNewMatchingText || countIncreased || changedFromPrevious;
        },
        text,
        beforeCount,
        beforeLastText,
        beforeRecentTexts,
        { timeout: timeoutMs }
      );
      return true;
    } catch {
      return false;
    }
  }

  async function resolveThreadIdAfterSend(page, waitMs = 9000) {
    const fromUrl = () => {
      const currentUrl = page.url();
      const match = currentUrl.match(/\/messaging\/thread\/([^/?#]+)/i);
      const candidate = match?.[1] || '';
      return isValidThreadId(candidate) ? candidate : '';
    };

    let chatId = fromUrl();
    if (chatId) return chatId;

    try {
      await page.waitForFunction(
        () => /\/messaging\/thread\/(?!new(?:\/|\?|$))[^/?#]+/i.test(window.location.pathname + window.location.search),
        { timeout: waitMs }
      );
      chatId = fromUrl();
      if (chatId) return chatId;
    } catch (_) {}

    try {
      chatId = await page.evaluate(() => {
        const normalizeThreadId = (value) => String(value || '').trim();
        const isValidThreadId = (value) => {
          const id = normalizeThreadId(value);
          if (!id) return false;
          if (id.toLowerCase() === 'new') return false;
          return true;
        };
        const idFromHref = (href) => {
          const raw = String(href || '');
          const fromThread = raw.match(/\/messaging\/thread\/([^/?#]+)/i)?.[1] || '';
          if (isValidThreadId(fromThread)) return normalizeThreadId(fromThread);

          const fromQuery = raw.match(/[?&](?:conversationId|threadId)=([^&#"\s]+)/i)?.[1] || '';
          if (fromQuery) {
            try {
              const decoded = decodeURIComponent(fromQuery);
              if (isValidThreadId(decoded)) return normalizeThreadId(decoded);
            } catch {}
            if (isValidThreadId(fromQuery)) return normalizeThreadId(fromQuery);
          }

          const fromConversationUrn = raw.match(/[?&]conversationUrn=([^&#"\s]+)/i)?.[1] || '';
          if (fromConversationUrn) {
            try {
              const decoded = decodeURIComponent(fromConversationUrn);
              const urnMatch = decoded.match(/fs(?:d)?_conversation:([^,"\s)]+)/i);
              const urnId = urnMatch?.[1] || '';
              if (isValidThreadId(urnId)) return normalizeThreadId(urnId);
            } catch {}
          }

          const urnMatch = raw.match(/fs(?:d)?_conversation:([^,"\s)]+)/i);
          const urnId = urnMatch?.[1] || '';
          if (isValidThreadId(urnId)) return normalizeThreadId(urnId);

          return '';
        };

        const candidates = Array.from(
          document.querySelectorAll(
            'a[href*="/messaging/"], [data-conversation-id], [data-urn*="conversation"]'
          )
        );
        for (const node of candidates) {
          const href = node.getAttribute?.('href') || '';
          const idFromLink = idFromHref(href);
          if (idFromLink) return idFromLink;

          const conversationId = node.getAttribute?.('data-conversation-id') || '';
          if (isValidThreadId(conversationId)) return normalizeThreadId(conversationId);

          const urn = node.getAttribute?.('data-urn') || '';
          const urnMatch = urn.match(/fs_conversation:([^,\s)]+)/i);
          if (isValidThreadId(urnMatch?.[1])) return normalizeThreadId(urnMatch[1]);
        }

        const params = new URLSearchParams(window.location.search || '');
        const explicitThreadId = params.get('threadId') || params.get('conversationId');
        if (isValidThreadId(explicitThreadId)) return normalizeThreadId(explicitThreadId);

        const conversationUrn = params.get('conversationUrn') || '';
        const urnIdMatch = conversationUrn.match(/fs_conversation:([^,\s)]+)/i);
        if (isValidThreadId(urnIdMatch?.[1])) return normalizeThreadId(urnIdMatch[1]);

        const resources = performance.getEntriesByType('resource') || [];
        for (let i = resources.length - 1; i >= 0; i -= 1) {
          const resourceUrl = String(resources[i]?.name || '');
          const fromMessagingApi = resourceUrl.match(/messaging\/conversations\/([^/?#]+)/i);
          if (isValidThreadId(fromMessagingApi?.[1])) return normalizeThreadId(fromMessagingApi[1]);
        }
        return '';
      });
    } catch (_) {
      chatId = '';
    }

    return isValidThreadId(chatId) ? chatId : '';
  }

  async function resolveThreadIdFromConversationPreview(page, messageText, waitMs = 12000) {
    const target = normalizeText(messageText);
    if (!target) return '';
    const excerpt = target.slice(0, 48).toLowerCase();
    const deadline = Date.now() + waitMs;

    while (Date.now() < deadline) {
      try {
        const chatId = await page.evaluate((needle) => {
          const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
          const extractThreadId = (rawValue) => {
            const raw = String(rawValue || '');
            if (!raw) return '';

            const fromThread = raw.match(/\/messaging\/thread\/([^/?#]+)/i)?.[1] || '';
            if (fromThread && fromThread.toLowerCase() !== 'new') return fromThread.trim();

            const fromQuery = raw.match(/[?&](?:conversationId|threadId)=([^&#"\s]+)/i)?.[1] || '';
            if (fromQuery && fromQuery.toLowerCase() !== 'new') {
              try {
                const decoded = decodeURIComponent(fromQuery);
                if (decoded && decoded.toLowerCase() !== 'new') return decoded.trim();
              } catch {}
              return fromQuery.trim();
            }

            const fromConversationUrn = raw.match(/[?&]conversationUrn=([^&#"\s]+)/i)?.[1] || '';
            if (fromConversationUrn) {
              try {
                const decoded = decodeURIComponent(fromConversationUrn);
                const urn = decoded.match(/fs(?:d)?_conversation:([^,"\s)]+)/i)?.[1] || '';
                if (urn && urn.toLowerCase() !== 'new') return urn.trim();
              } catch {}
            }

            const urn = raw.match(/fs(?:d)?_conversation:([^,"\s)]+)/i)?.[1] || '';
            if (urn && urn.toLowerCase() !== 'new') return urn.trim();

            return '';
          };

          const isValidThreadId = (value) => {
            const id = String(value || '').trim();
            if (!id) return false;
            if (id.toLowerCase() === 'new') return false;
            return true;
          };

          const anchors = Array.from(
            document.querySelectorAll('a[href*="/messaging/"], [data-conversation-id], [data-urn*="conversation"]')
          );
          for (const anchor of anchors) {
            const href = anchor.getAttribute?.('href') || '';
            const dataConversationId = anchor.getAttribute?.('data-conversation-id') || '';
            const dataUrn = anchor.getAttribute?.('data-urn') || '';
            const candidateId =
              extractThreadId(href) ||
              extractThreadId(dataConversationId) ||
              extractThreadId(dataUrn);
            if (!isValidThreadId(candidateId)) continue;

            const row =
              anchor.closest('.msg-conversation-listitem, .msg-conversation-card, li, [data-view-name*="conversation"]') ||
              anchor;
            const rowText = normalize(row?.textContent).toLowerCase();
            if (rowText.includes(needle)) {
              return String(candidateId).trim();
            }
          }
          return '';
        }, excerpt);

        if (isValidThreadId(chatId)) {
          return chatId;
        }
      } catch (_) {}

      await delay(600, 900);
    }

    return '';
  }

  function buildConversationNeedles(profileUrl, participantName, messageText) {
    const targetSlug = String(profileUrl || '').match(/linkedin\.com\/in\/([^/?#]+)/i)?.[1] || '';
    const slugNeedle = slugToName(targetSlug).toLowerCase();
    const nameNeedle = normalizeText(participantName).toLowerCase();
    const textNeedle = normalizeText(messageText).slice(0, 48).toLowerCase();
    const tokenNeedles = Array.from(new Set(
      `${slugNeedle} ${nameNeedle}`
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3)
    ));

    return {
      slugNeedle,
      nameNeedle,
      textNeedle,
      tokenNeedles,
    };
  }

  async function resolveThreadIdFromCurrentMessagingView(
    page,
    { profileUrl, participantName, messageText }
  ) {
    const { slugNeedle, nameNeedle, textNeedle, tokenNeedles } =
      buildConversationNeedles(profileUrl, participantName, messageText);
    const normalizedProfileUrl = normalizeProfileUrlForCompare(profileUrl);

    try {
      const result = await page.evaluate(
        ({ slugNeedleInput, nameNeedleInput, textNeedleInput, tokenNeedlesInput, targetProfileUrl }) => {
          const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
          const normalizeUrl = (value) => {
            try {
              const parsed = new URL(String(value || '').trim());
              parsed.hash = '';
              parsed.search = '';
              parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
              return parsed.toString().replace(/\/$/, '');
            } catch {
              return String(value || '').trim().replace(/\/+$/, '');
            }
          };
          const extractThreadId = (rawValue) => {
            const raw = String(rawValue || '');
            if (!raw) return '';

            const fromThread = raw.match(/\/messaging\/thread\/([^/?#]+)/i)?.[1] || '';
            if (fromThread && fromThread.toLowerCase() !== 'new') return fromThread.trim();

            const fromQuery = raw.match(/[?&](?:conversationId|threadId)=([^&#"\s]+)/i)?.[1] || '';
            if (fromQuery && fromQuery.toLowerCase() !== 'new') {
              try {
                const decoded = decodeURIComponent(fromQuery);
                if (decoded && decoded.toLowerCase() !== 'new') return decoded.trim();
              } catch {}
              return fromQuery.trim();
            }

            const fromConversationUrn = raw.match(/[?&]conversationUrn=([^&#"\s]+)/i)?.[1] || '';
            if (fromConversationUrn) {
              try {
                const decoded = decodeURIComponent(fromConversationUrn);
                const urn = decoded.match(/fs(?:d)?_conversation:([^,"\s)]+)/i)?.[1] || '';
                if (urn && urn.toLowerCase() !== 'new') return urn.trim();
              } catch {}
            }

            const urn = raw.match(/fs(?:d)?_conversation:([^,"\s)]+)/i)?.[1] || '';
            if (urn && urn.toLowerCase() !== 'new') return urn.trim();

            return '';
          };
          const isValidThreadId = (value) => {
            const id = String(value || '').trim();
            if (!id) return false;
            if (id.toLowerCase() === 'new') return false;
            return true;
          };
          const pushText = (bucket, value) => {
            const normalized = normalize(value);
            if (normalized) bucket.push(normalized);
          };

          const currentThreadId = extractThreadId(window.location.href);
          if (!isValidThreadId(currentThreadId)) {
            return { threadId: '', score: 0, reason: 'no-thread-in-url' };
          }

          const roots = [];
          const selectedConversation = document.querySelector(
            [
              '.msg-conversation-listitem--selected',
              '.msg-conversation-listitem--active',
              '.msg-conversation-card--active',
              '.msg-conversation-listitem[aria-current="true"]',
              '[aria-current="page"]',
            ].join(', ')
          );
          if (selectedConversation) roots.push(selectedConversation);

          const threadHeader = document.querySelector(
            [
              '.msg-thread',
              '.msg-thread__container',
              '.msg-overlay-conversation-bubble',
              '[data-view-name*="thread"]',
              '[data-view-name*="messaging-detail"]',
            ].join(', ')
          );
          if (threadHeader) roots.push(threadHeader);
          if (roots.length === 0) roots.push(document.body);

          const profileLinks = [];
          const collectedTexts = [];

          for (const root of roots) {
            if (!root) continue;

            for (const anchor of Array.from(root.querySelectorAll('a[href*="/in/"]'))) {
              const href = normalizeUrl(anchor.href || anchor.getAttribute?.('href') || '');
              if (href) profileLinks.push(href);
              pushText(collectedTexts, anchor.getAttribute?.('aria-label') || anchor.textContent || '');
            }

            const textSelectors = [
              'h1',
              'h2',
              'h3',
              '.msg-thread__subject',
              '.msg-thread__link-to-profile',
              '.msg-thread__link-to-profile-name',
              '.msg-conversation-listitem__participant-names',
              '.msg-conversation-card__participant-names',
              '[data-view-name*="conversation"]',
            ];
            for (const selector of textSelectors) {
              for (const node of Array.from(root.querySelectorAll(selector))) {
                pushText(collectedTexts, node.textContent || '');
              }
            }
            pushText(collectedTexts, root.textContent || '');
          }

          const haystack = collectedTexts.join(' ').toLowerCase();
          let score = 0;
          const reasons = [];

          if (targetProfileUrl && profileLinks.some((href) => href === targetProfileUrl)) {
            score += 10;
            reasons.push('profile-link');
          }
          if (textNeedleInput && haystack.includes(textNeedleInput)) {
            score += 5;
            reasons.push('message-text');
          }
          if (nameNeedleInput && haystack.includes(nameNeedleInput)) {
            score += 4;
            reasons.push('name');
          }
          if (slugNeedleInput && haystack.includes(slugNeedleInput)) {
            score += 3;
            reasons.push('slug');
          }
          if (Array.isArray(tokenNeedlesInput)) {
            let tokenHits = 0;
            for (const token of tokenNeedlesInput) {
              if (token && haystack.includes(String(token).toLowerCase())) {
                tokenHits += 1;
              }
            }
            if (tokenHits > 0) {
              score += Math.min(4, tokenHits);
              reasons.push(`tokens:${tokenHits}`);
            }
          }

          if (score < 2) {
            return { threadId: '', score, reason: reasons.join(',') || 'no-match' };
          }

          return {
            threadId: currentThreadId,
            score,
            reason: reasons.join(',') || 'matched-current-thread',
          };
        },
        {
          slugNeedleInput: slugNeedle,
          nameNeedleInput: nameNeedle,
          textNeedleInput: textNeedle,
          tokenNeedlesInput: tokenNeedles,
          targetProfileUrl: normalizedProfileUrl,
        }
      );

      return {
        threadId: isValidThreadId(result?.threadId) ? result.threadId : '',
        score: Number(result?.score || 0),
        reason: String(result?.reason || ''),
      };
    } catch {
      return { threadId: '', score: 0, reason: 'current-thread-inspection-failed' };
    }
  }

  function scoreConversationRowText(rowText, { slugNeedle, nameNeedle, textNeedle, tokenNeedles }) {
    const hay = normalizeText(rowText).toLowerCase();
    if (!hay) return 0;

    let score = 0;
    if (textNeedle && hay.includes(textNeedle)) score += 5;
    if (nameNeedle && hay.includes(nameNeedle)) score += 3;
    if (slugNeedle && hay.includes(slugNeedle)) score += 2;
    if (Array.isArray(tokenNeedles)) {
      let tokenHits = 0;
      for (const token of tokenNeedles) {
        if (token && hay.includes(String(token).toLowerCase())) {
          tokenHits += 1;
        }
      }
      score += Math.min(4, tokenHits);
    }
    return score;
  }

  async function resolveThreadIdFromMessagingHome(page, { accountId = 'unknown', profileUrl, participantName, messageText }, waitMs = 15000) {
    const { slugNeedle, nameNeedle, textNeedle, tokenNeedles } =
      buildConversationNeedles(profileUrl, participantName, messageText);

    try {
      await gotoMessagingHomeLenient(page, accountId, 30000);
    } catch (_) {
      return '';
    }

    await page.waitForSelector('a[href*="/messaging/thread/"], .msg-conversation-listitem', {
      timeout: 12000,
    }).catch(() => null);

    const currentThreadMatch = await resolveThreadIdFromCurrentMessagingView(page, {
      profileUrl,
      participantName,
      messageText,
    });
    if (currentThreadMatch.threadId) {
      logSendStep(
        accountId,
        `thread id resolved from current messaging view (${currentThreadMatch.reason || 'matched-current-thread'})`
      );
      return currentThreadMatch.threadId;
    }

    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      try {
        const chatId = await page.evaluate(({ slugNeedleInput, nameNeedleInput, textNeedleInput, tokenNeedlesInput }) => {
          const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
          const extractThreadId = (rawValue) => {
            const raw = String(rawValue || '');
            if (!raw) return '';

            const fromThread = raw.match(/\/messaging\/thread\/([^/?#]+)/i)?.[1] || '';
            if (fromThread && fromThread.toLowerCase() !== 'new') return fromThread.trim();

            const fromQuery = raw.match(/[?&](?:conversationId|threadId)=([^&#"\s]+)/i)?.[1] || '';
            if (fromQuery && fromQuery.toLowerCase() !== 'new') {
              try {
                const decoded = decodeURIComponent(fromQuery);
                if (decoded && decoded.toLowerCase() !== 'new') return decoded.trim();
              } catch {}
              return fromQuery.trim();
            }

            const fromConversationUrn = raw.match(/[?&]conversationUrn=([^&#"\s]+)/i)?.[1] || '';
            if (fromConversationUrn) {
              try {
                const decoded = decodeURIComponent(fromConversationUrn);
                const urn = decoded.match(/fs(?:d)?_conversation:([^,"\s)]+)/i)?.[1] || '';
                if (urn && urn.toLowerCase() !== 'new') return urn.trim();
              } catch {}
            }

            const urn = raw.match(/fs(?:d)?_conversation:([^,"\s)]+)/i)?.[1] || '';
            if (urn && urn.toLowerCase() !== 'new') return urn.trim();

            return '';
          };

          const isValidThreadId = (value) => {
            const id = String(value || '').trim();
            if (!id) return false;
            if (id.toLowerCase() === 'new') return false;
            return true;
          };

          const candidates = Array.from(
            document.querySelectorAll('a[href*="/messaging/"], [data-conversation-id], [data-urn*="conversation"]')
          );
          let bestMatch = { id: '', score: -1 };

          for (const anchor of candidates) {
            const href = anchor.getAttribute?.('href') || '';
            const dataConversationId = anchor.getAttribute?.('data-conversation-id') || '';
            const dataUrn = anchor.getAttribute?.('data-urn') || '';
            const candidateId =
              extractThreadId(href) ||
              extractThreadId(dataConversationId) ||
              extractThreadId(dataUrn);
            if (!isValidThreadId(candidateId)) continue;

            const row =
              anchor.closest('.msg-conversation-listitem, .msg-conversation-card, li, [data-view-name*="conversation"]') ||
              anchor;
            const rowText = normalize(row?.textContent).toLowerCase();
            if (!rowText) continue;

            let score = 0;
            if (textNeedleInput && rowText.includes(textNeedleInput)) score += 5;
            if (nameNeedleInput && rowText.includes(nameNeedleInput)) score += 3;
            if (slugNeedleInput && rowText.includes(slugNeedleInput)) score += 2;
            if (Array.isArray(tokenNeedlesInput)) {
              let tokenHits = 0;
              for (const token of tokenNeedlesInput) {
                if (token && rowText.includes(String(token).toLowerCase())) {
                  tokenHits += 1;
                }
              }
              score += Math.min(4, tokenHits);
            }

            if (score > bestMatch.score) {
              bestMatch = { id: String(candidateId).trim(), score };
            }
          }

          return bestMatch.score >= 2 ? bestMatch.id : '';
        }, {
          slugNeedleInput: slugNeedle,
          nameNeedleInput: nameNeedle,
          textNeedleInput: textNeedle,
          tokenNeedlesInput: tokenNeedles,
        });

        if (isValidThreadId(chatId)) {
          return chatId;
        }
      } catch (_) {}

      await delay(600, 900);
    }

    return '';
  }

  async function resolveThreadIdByClickingConversationCandidates(
    page,
    { accountId, profileUrl, participantName, messageText },
    waitMs = 22000
  ) {
    const needles = buildConversationNeedles(profileUrl, participantName, messageText);
    const deadline = Date.now() + waitMs;

    while (Date.now() < deadline) {
      try {
        await gotoMessagingHomeLenient(page, accountId, 30000);
      } catch (_) {
        return '';
      }

      await page.waitForSelector('a[href*="/messaging/thread/"], .msg-conversation-listitem', {
        timeout: 12000,
      }).catch(() => null);

      const rowLocator = page.locator(
        '.msg-conversation-listitem, .msg-conversation-card, li[data-view-name*="conversation"]'
      );
      const rowCount = Math.min(await rowLocator.count().catch(() => 0), 15);
      if (rowCount === 0) {
        await delay(700, 1000);
        continue;
      }

      const ranked = [];
      for (let i = 0; i < rowCount; i += 1) {
        const row = rowLocator.nth(i);
        const rowText = await row.innerText().catch(() => '');
        const score = scoreConversationRowText(rowText, needles);
        if (score > 0) {
          ranked.push({ index: i, score, text: truncateForLog(rowText, 90) });
        }
      }

      ranked.sort((a, b) => b.score - a.score);
      const candidates = ranked.slice(0, Math.min(5, ranked.length));
      if (candidates.length === 0) {
        await delay(700, 1000);
        continue;
      }

      for (const candidate of candidates) {
        const row = rowLocator.nth(candidate.index);
        try {
          await row.scrollIntoViewIfNeeded().catch(() => {});
          await row.click({ timeout: 5000 });
        } catch (_) {
          continue;
        }

        await delay(500, 900);
        const chatId = await resolveThreadIdAfterSend(page, 5000);
        if (isValidThreadId(chatId)) {
          logSendStep(
            accountId,
            `thread id resolved by opening conversation row (score=${candidate.score}): ${candidate.text}`
          );
          return chatId;
        }
      }

      await delay(700, 1000);
    }

    return '';
  }

  async function confirmMessagePersistedInThread(page, chatId, text, timeoutMs = 15000) {
    const normalizedChatId = String(chatId || '').trim();
    const target = normalizeText(text);
    if (!normalizedChatId || !target) return false;

    try {
      await page.goto(`https://www.linkedin.com/messaging/thread/${normalizedChatId}/`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
    } catch (_) {
      // Continue and try selector-based confirmation from current DOM.
    }

    const waitForPersistedText = async (waitMs) => {
      try {
        await page.waitForFunction(
          (needle) => {
            const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
            const targetText = normalize(needle);
            if (!targetText) return false;

            const nodes = Array.from(
              document.querySelectorAll(
                [
                  '.msg-s-message-list__event--own-turn .msg-s-event__content',
                  '[data-view-name="messaging-self-message"] .msg-s-event__content',
                  '.msg-s-event-listitem .msg-s-event__content',
                  '.msg-s-event-listitem .msg-s-event-listitem__body',
                  '[data-view-name="messaging-message-list-item"] .msg-s-event__content',
                  '[data-view-name="messaging-message-list-item"] .msg-s-event-listitem__body',
                  '[data-view-name="messaging-message-list-item"] [dir]',
                  '.msg-s-event__content',
                  '[data-test-message-content]',
                ].join(', ')
              )
            );

            const hasDirectMatch = nodes.some((node) => {
              const value = normalize(node?.textContent);
              return value && (value.includes(targetText) || targetText.includes(value));
            });
            if (hasDirectMatch) return true;

            const rowNodes = Array.from(
              document.querySelectorAll('.msg-s-event-listitem, [data-view-name="messaging-message-list-item"]')
            );
            const hasRowMatch = rowNodes.some((row) => {
              const value = normalize(row?.textContent);
              return value && (value.includes(targetText) || targetText.includes(value));
            });
            if (hasRowMatch) return true;

            const listContainer = document.querySelector('.msg-s-message-list, [data-view-name="messaging-message-list"]');
            const listText = normalize(listContainer?.textContent);
            return Boolean(listText && (listText.includes(targetText) || targetText.includes(listText)));
          },
          text,
          { timeout: waitMs }
        );
        return true;
      } catch {
        return false;
      }
    };

    await page.waitForSelector('.msg-s-message-list, [data-view-name="messaging-message-list"]', {
      timeout: 8000,
    }).catch(() => null);

    if (await waitForPersistedText(timeoutMs)) {
      return true;
    }

    try {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (_) {}

    await page.waitForSelector('.msg-s-message-list, [data-view-name="messaging-message-list"]', {
      timeout: 8000,
    }).catch(() => null);

    return waitForPersistedText(Math.max(8000, Math.floor(timeoutMs / 2)));
  }

  async function confirmMessageVisibleInCurrentView(page, text, timeoutMs = 15000) {
    const target = normalizeText(text);
    if (!target) return false;

    try {
      await page.waitForFunction(
        (needle) => {
          const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
          const targetText = normalize(needle);
          if (!targetText) return false;

          const nodes = Array.from(
            document.querySelectorAll(
              [
                '.msg-s-message-list__event--own-turn .msg-s-event__content',
                '[data-view-name="messaging-self-message"] .msg-s-event__content',
                '.msg-s-event-listitem .msg-s-event__content',
                '.msg-s-event-listitem .msg-s-event-listitem__body',
                '[data-view-name="messaging-message-list-item"] .msg-s-event__content',
                '[data-view-name="messaging-message-list-item"] .msg-s-event-listitem__body',
                '[data-view-name="messaging-message-list-item"] [dir]',
                '.msg-s-event__content',
                '[data-test-message-content]',
              ].join(', ')
            )
          );
          const hasDirectMatch = nodes.some((node) => {
            const value = normalize(node?.textContent);
            return value && (value.includes(targetText) || targetText.includes(value));
          });
          if (hasDirectMatch) return true;

          const rowNodes = Array.from(
            document.querySelectorAll('.msg-s-event-listitem, [data-view-name="messaging-message-list-item"]')
          );
          const hasRowMatch = rowNodes.some((row) => {
            const value = normalize(row?.textContent);
            return value && (value.includes(targetText) || targetText.includes(value));
          });
          if (hasRowMatch) return true;

          const listContainer = document.querySelector('.msg-s-message-list, [data-view-name="messaging-message-list"]');
          const listText = normalize(listContainer?.textContent);
          return Boolean(listText && (listText.includes(targetText) || targetText.includes(listText)));
        },
        text,
        { timeout: timeoutMs }
      );
      return true;
    } catch {
      return false;
    }
  }

  return {
    normalizeThreadIdCandidate,
    isValidThreadId,
    createNetworkThreadIdProbe,
    getMessageSnapshot,
    verifyMessageEcho,
    resolveThreadIdAfterSend,
    resolveThreadIdFromConversationPreview,
    resolveThreadIdFromMessagingHome,
    resolveThreadIdByClickingConversationCandidates,
    confirmMessagePersistedInThread,
    confirmMessageVisibleInCurrentView,
  };
}

module.exports = {
  createSendMessageThreadHelpers,
};
