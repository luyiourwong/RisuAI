//@name ⌨️ 鍵盤訊息導航 (Home/End/PgUp/PgDn) v1.1
//@display-name ⌨️ 鍵盤訊息導航 v1.1
//@api 2.1
//@version 1.1
//@description 使用鍵盤鍵位在訊息間跳轉：Home 第一則, End 最後一則, PageUp 上一則, PageDown 下一則

const MESSAGE_SELECTORS = [
    "div.flex.max-w-full.justify-center.risu-chat",
    ".chat-width",
    ".risu-chat",
    "[class*='risu-chat']",
    "[class*='chat-message']",
    "[class*='message']"
];

let cursorIndex = -1;

function getMessages() {
    for (let i = 0; i < MESSAGE_SELECTORS.length; i++) {
        const nodes = Array.from(document.querySelectorAll(MESSAGE_SELECTORS[i]));
        // 過濾掉隱藏或高度為 0 的元素，確保跳轉正確
        if (nodes.length > 0) return nodes.filter(n => n.offsetHeight > 0);
    }
    return [];
}

function scrollToMessage(node, block, behavior) {
    if (!node) return;
    node.scrollIntoView({
        block: block || "start",
        inline: "nearest",
        behavior: behavior || "smooth"
    });
}

function findCurrentIndex(messages) {
    if (!messages || messages.length === 0) return -1;

    let bestIndex = 0;
    let bestDistance = Infinity;
    const viewportTop = 0;

    for (let i = 0; i < messages.length; i++) {
        const rect = messages[i].getBoundingClientRect();
        // 尋找最靠近視窗頂部的訊息
        const distance = Math.abs(rect.top - viewportTop);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = i;
        }
    }
    return bestIndex;
}

function normalizeCursor(messages) {
    if (!messages || messages.length === 0) {
        cursorIndex = -1;
        return -1;
    }

    // 如果目前沒有紀錄 index，或紀錄已過期，則根據捲動位置重新抓取
    if (cursorIndex < 0 || cursorIndex >= messages.length) {
        cursorIndex = findCurrentIndex(messages);
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

function handleKeyDown(e) {
    // 檢查是否在輸入框內，避免打字時觸發跳轉
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.isContentEditable)) {
        return;
    }

    const key = e.key;
    if (!isNavKey(key)) return;

    const messages = getMessages();
    if (messages.length === 0) return;

    // 阻止瀏覽器預設的捲動行為
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") {
        e.stopImmediatePropagation();
    }

    // 邏輯處理
    if (key === "Home") {
        cursorIndex = 0;
        scrollToMessage(messages[cursorIndex], "start", "smooth");
        return;
    }

    if (key === "End") {
        cursorIndex = messages.length - 1;
        scrollToMessage(messages[cursorIndex], "start", "smooth");
        return;
    }

    const currentIndex = normalizeCursor(messages);
    if (currentIndex < 0) return;

    if (key === "PageUp") {
        // 往前(往上)找一則
        cursorIndex = Math.max(0, currentIndex - 1);
        scrollToMessage(messages[cursorIndex], "start", "smooth");
        return;
    }

    if (key === "PageDown") {
        // 往後(往下)找一則
        cursorIndex = Math.min(messages.length - 1, currentIndex + 1);
        scrollToMessage(messages[cursorIndex], "start", "smooth");
        return;
    }
}

document.addEventListener("keydown", handleKeyDown, true);

if (typeof onUnload === "function") {
    onUnload(() => {
        document.removeEventListener("keydown", handleKeyDown, true);
    });
}