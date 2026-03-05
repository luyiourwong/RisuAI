//@name KeyboardControl
//@display-name ⌨️ Keyboard Control v1.1
//@api 3.0
//@version 1.1.0
//@description 使用鍵盤鍵位在訊息間跳轉：Home 第一則, End 最後一則, PageUp 上一則, PageDown 下一則

(async () => {
    const PLUGIN_NAME = "KeyboardControl";

    const MESSAGE_SELECTORS = [
        "div.flex.max-w-full.justify-center.risu-chat",
        ".chat-width",
        ".risu-chat",
        "[class*='risu-chat']",
        "[class*='chat-message']",
        "[class*='message']"
    ];

    let cursorIndex = -1;
    let rootDoc = null;

    try {
        rootDoc = await risuai.getRootDocument();
    } catch (e) {
        console.error(`[${PLUGIN_NAME}] Failed to get root document:`, e);
        return;
    }

    async function getNodeHeight(node) {
        if (!node) return 0;

        if (typeof node.clientHeight === "function") {
            const h = await node.clientHeight();
            return Number.isFinite(h) ? h : 0;
        }

        if (typeof node.getBoundingClientRect === "function") {
            const rect = await node.getBoundingClientRect();
            const h = rect?.height;
            return Number.isFinite(h) ? h : 0;
        }

        return 0;
    }

    async function getMessages() {
        for (let i = 0; i < MESSAGE_SELECTORS.length; i++) {
            const nodes = await rootDoc.querySelectorAll(MESSAGE_SELECTORS[i]);
            if (nodes.length > 0) {
                // 過濾掉隱藏或高度為 0 的元素，確保跳轉正確
                const visibleNodes = [];
                for (const node of nodes) {
                    console.log("node methods:", typeof node.clientHeight, typeof node.getBoundingClientRect);
                    const height = await getNodeHeight(node);
                    if (height > 0) {
                        visibleNodes.push(node);
                    }
                }
                if (visibleNodes.length > 0) return visibleNodes;
            }
        }
        return [];
    }

    async function scrollToMessage(node, block, behavior) {
        if (!node) return;
        await node.scrollIntoView({
            block: block || "start",
            inline: "nearest",
            behavior: behavior || "smooth"
        });
    }

    async function findCurrentIndex(messages) {
        if (!messages || messages.length === 0) return -1;

        let bestIndex = 0;
        let bestDistance = Infinity;
        const viewportTop = 0;

        for (let i = 0; i < messages.length; i++) {
            const rect = await messages[i].getBoundingClientRect();
            // 尋找最靠近視窗頂部的訊息
            const distance = Math.abs(rect.top - viewportTop);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestIndex = i;
            }
        }
        return bestIndex;
    }

    async function normalizeCursor(messages) {
        if (!messages || messages.length === 0) {
            cursorIndex = -1;
            return -1;
        }

        // 如果目前沒有紀錄 index，或紀錄已過期，則根據捲動位置重新抓取
        if (cursorIndex < 0 || cursorIndex >= messages.length) {
            cursorIndex = await findCurrentIndex(messages);
        }

        if (cursorIndex < 0) cursorIndex = 0;
        return cursorIndex;
    }

    function isNavKey(key) {
        return (
            key === "Home" || 
            key === "End" || 
            key === "PageUp" || 
            key === "PageDown"
        );
    }

    async function handleKeyDown(e) {
        // 注意：v3 無法取得 document.activeElement，也無法呼叫 e.preventDefault()
        // 因此在輸入框打字時按下這些鍵也會觸發跳轉，且無法阻止瀏覽器預設的 PageUp/PageDown 捲動行為。
        
        const key = e.key;
        if (!isNavKey(key)) return;

        const messages = await getMessages();
        if (messages.length === 0) return;

        // 邏輯處理
        if (key === "Home") {
            cursorIndex = 0;
            await scrollToMessage(messages[cursorIndex], "start", "smooth");
            return;
        }

        if (key === "End") {
            cursorIndex = messages.length - 1;
            await scrollToMessage(messages[cursorIndex], "start", "smooth");
            return;
        }

        const currentIndex = await normalizeCursor(messages);
        if (currentIndex < 0) return;

        if (key === "PageUp") {
            // 往前(往上)找一則
            cursorIndex = Math.max(0, currentIndex - 1);
            await scrollToMessage(messages[cursorIndex], "start", "smooth");
            return;
        }

        if (key === "PageDown") {
            // 往後(往下)找一則
            cursorIndex = Math.min(messages.length - 1, currentIndex + 1);
            await scrollToMessage(messages[cursorIndex], "start", "smooth");
            return;
        }
    }

    const body = await rootDoc.querySelector('body');
    if (body) {
        const listenerId = await body.addEventListener("keydown", handleKeyDown, true);
        
        await risuai.onUnload(async () => {
            await body.removeEventListener("keydown", listenerId, true);
        });
    }

    console.log(`[${PLUGIN_NAME}] Loaded.`);
})();
