//@name AutoImageGen
//@display-name 自動生圖插件
//@api 3.0
//@version 1.0.0
//@description 根據角色回覆自動生成圖片並嵌入對話中。

(async () => {
    const PLUGIN_NAME = "AutoImageGen";

    // 取得當前角色的自動生圖開關狀態
    const isAutoGenEnabled = async (charId) => {
        const key = `autogen_${charId}`;
        const val = await Risuai.pluginStorage.getItem(key);
        return val === true;
    };

    // 設定當前角色的自動生圖開關狀態
    const setAutoGenEnabled = async (charId, enabled) => {
        const key = `autogen_${charId}`;
        await Risuai.pluginStorage.setItem(key, enabled);
    };

    // 註冊一個按鈕來切換開關
    await Risuai.registerButton({
        name: '切換自動生圖 (Toggle Auto Gen)',
        icon: '🎨',
        iconType: 'html',
        location: 'action'
    }, async () => {
        const char = await Risuai.getCharacter();
        if (!char) {
            await Risuai.alert("未選擇角色");
            return;
        }

        const currentState = await isAutoGenEnabled(char.chaId);
        const newState = !currentState;
        await setAutoGenEnabled(char.chaId, newState);

        await Risuai.alert(`角色 [${char.name}] 的自動生圖功能已: ${newState ? '開啟' : '關閉'}`);
    });

    // 註冊 Replacer 來處理回覆
    await Risuai.addRisuReplacer('afterRequest', async (content, type) => {
        // 1. 檢查是否開啟
        const char = await Risuai.getCharacter();
        if (!char) return content;

        const enabled = await isAutoGenEnabled(char.chaId);
        if (!enabled) return content;

        // 2. 處理內容 (移除 <Thoughts> 標籤，避免影響 Prompt)
        let processedResult = content.replace(/<Thoughts>(.+)<\/Thoughts>/gms, '');

        // 3. 獲取 Prompt 設定
        // 假設角色卡中已有 newGenData 欄位 (RisuAI 標準欄位)
        const genData = char.newGenData;
        if (!genData || !genData.prompt) return content;

        const promptTemplate = genData.prompt;
        const negative = genData.negative || '';

        // 替換 {{slot}}
        const finalPrompt = promptTemplate.replaceAll('{{slot}}', processedResult);

        try {
            // --- 調用新增的 API ---
            // 調用本體的生圖功能
            const imageBase64 = await Risuai.generateImage(finalPrompt, negative);

            if (imageBase64) {
                // --- 調用新增的 API ---
                // 將 Base64 存為 Inlay 並取得 ID
                const inlayId = await Risuai.createInlay(imageBase64);

                if (inlayId) {
                    // 附加 Inlay 標籤
                    return content + ` {{inlay::${inlayId}}}`;
                }
            }
        } catch (e) {
            console.error(`[${PLUGIN_NAME}] Error: ${e.message}`, e);
        }

        return content;
    });

    console.log(`[${PLUGIN_NAME}] Loaded.`);
})();