export const delay = (minMs, maxMs) => {
    const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return new Promise(resolve => setTimeout(resolve, ms));
};

export const humanClick = async (page, selector) => {
    const element = await page.waitForSelector(selector, { timeout: 15000 });
    const box = await element.boundingBox();
    if (!box) throw new Error('[humanClick] Element not visible: ' + selector);

    const targetX = box.x + (box.width * 0.2) + (Math.random() * box.width * 0.6);
    const targetY = box.y + (box.height * 0.2) + (Math.random() * box.height * 0.6);

    // Move from a natural "resting" position first — not from 0,0
    await page.mouse.move(
        100 + Math.random() * 500,
        100 + Math.random() * 300,
        { steps: 6 }
    );
    await delay(80, 200);

    // Then move to target with natural arc
    await page.mouse.move(targetX, targetY, { steps: 12 });
    await delay(100, 300);
    await page.mouse.click(targetX, targetY);
};

export const humanType = async (page, selector, text) => {
    await humanClick(page, selector);
    await delay(200, 500);

    for (const char of text) {
        await page.keyboard.type(char, { delay: 60 + Math.random() * 100 });
        if (Math.random() < 0.03) {
            await delay(400, 900);
        }
    }
};

export const humanScroll = async (page, distancePx) => {
    const steps = 8 + Math.floor(Math.random() * 5);
    const stepSize = distancePx / steps;

    for (let i = 0; i < steps; i++) {
        await page.mouse.wheel(0, stepSize);
        await delay(30, 80);
    }
};
