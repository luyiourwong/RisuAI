//@name CommentBot
//@display-name Comment Bot
//@api 3.0
//@version 1.0.0
//@description A side-chat panel for asking advice about the current chat history
//@arg api_url string OpenAI-compatible chat completions endpoint URL
//@arg api_key string API key for the advice model
//@arg model string Model name for the advice model
//@arg system_prompt string System prompt for the advice assistant
//@arg max_sync_messages int Maximum synced messages from the current chat

(async () => {
  const PLUGIN_NAME = 'CommentBot';
  const STORAGE_KEYS = {
    syncTranscript: 'syncTranscript',
    panelMessages: 'panelMessages',
  };

  const DEFAULTS = {
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    systemPrompt:
      'You are a chat reviewer. Answer only based on the synced conversation and the user question. Give practical suggestions, feedback, and concise summaries.',
    maxSyncMessages: 50,
  };

  let syncedTranscript = '';
  let panelMessages = [];
  let isSending = false;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function loadPanelMessages(raw) {
    try {
      const parsed = JSON.parse(raw ?? '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item) => item && typeof item.role === 'string' && typeof item.content === 'string');
    } catch {
      return [];
    }
  }

  async function persistState() {
    await Risuai.pluginStorage.setItem(STORAGE_KEYS.syncTranscript, syncedTranscript);
    await Risuai.pluginStorage.setItem(STORAGE_KEYS.panelMessages, JSON.stringify(panelMessages));
  }

  async function bootstrapState() {
    syncedTranscript = (await Risuai.pluginStorage.getItem(STORAGE_KEYS.syncTranscript)) ?? '';
    panelMessages = loadPanelMessages(await Risuai.pluginStorage.getItem(STORAGE_KEYS.panelMessages));
  }

  function renderChatMessages() {
    const chatArea = document.getElementById('commentbot-messages');
    if (!chatArea) return;

    if (panelMessages.length === 0) {
      chatArea.innerHTML = '<div class="commentbot-empty">No messages yet.</div>';
      return;
    }

    chatArea.innerHTML = panelMessages
      .map((message) => {
        const cls = message.role === 'user' ? 'user' : 'assistant';
        const label = message.role === 'user' ? 'You' : 'Advisor';
        return `
          <div class="commentbot-message ${cls}">
            <div class="commentbot-label">${label}</div>
            <div class="commentbot-content">${escapeHtml(message.content)}</div>
          </div>
        `;
      })
      .join('');

    chatArea.scrollTop = chatArea.scrollHeight;
  }

  function renderSyncInfo() {
    const syncInfo = document.getElementById('commentbot-sync-info');
    if (!syncInfo) return;

    if (!syncedTranscript) {
      syncInfo.textContent = 'No synced chat history.';
      return;
    }

    const lineCount = syncedTranscript.split('\n').filter(Boolean).length;
    syncInfo.textContent = `Synced ${lineCount} lines from the current chat.`;
  }

  function setBusyState() {
    const sendButton = document.getElementById('commentbot-send');
    const syncButton = document.getElementById('commentbot-sync');
    const input = document.getElementById('commentbot-input');
    if (!sendButton || !syncButton || !input) return;

    sendButton.disabled = isSending;
    syncButton.disabled = isSending;
    input.disabled = isSending;
    sendButton.textContent = isSending ? 'Sending...' : 'Send';
  }

  async function syncMessages() {
    const characterIndex = await Risuai.getCurrentCharacterIndex();
    const chatIndex = await Risuai.getCurrentChatIndex();
    const character = await Risuai.getCharacter();
    const chat = await Risuai.getChatFromIndex(characterIndex, chatIndex);

    if (!chat || !Array.isArray(chat.message)) {
      syncedTranscript = '';
      await persistState();
      renderSyncInfo();
      return;
    }

    const maxSyncMessages = Number(await Risuai.getArgument('max_sync_messages')) || DEFAULTS.maxSyncMessages;
    const username = character?.userName || 'User';
    const characterName = character?.name || 'Character';
    const roleMap = {
      user: username,
      char: characterName,
      system: 'System',
      assistant: characterName,
    };

    const lines = chat.message
      .slice(-maxSyncMessages)
      .map((message) => {
        const speaker = roleMap[message?.role] || message?.role || 'Unknown';
        return `${speaker}: ${String(message?.data ?? '').trim()}`;
      })
      .filter((line) => line !== 'Unknown:' && line.trim() !== '');

    syncedTranscript = lines.join('\n');
    await persistState();
    renderSyncInfo();
  }

  function buildWrappedPrompt(userInput) {
    const historyBlock = syncedTranscript || 'No synced chat history.';
    return `${userInput}\n\n[Synced chat history]\n${historyBlock}`;
  }

  async function requestAdvice(userInput) {
    const apiUrl = String((await Risuai.getArgument('api_url')) || DEFAULTS.apiUrl).trim();
    const apiKey = String((await Risuai.getArgument('api_key')) || '').trim();
    const model = String((await Risuai.getArgument('model')) || '').trim();
    const systemPrompt = String((await Risuai.getArgument('system_prompt')) || DEFAULTS.systemPrompt).trim();

    if (!apiKey) {
      throw new Error('Missing api_key plugin argument.');
    }
    if (!model) {
      throw new Error('Missing model plugin argument.');
    }

    const response = await Risuai.nativeFetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...panelMessages.map((message) => ({
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: message.content,
          })),
          {
            role: 'user',
            content: buildWrappedPrompt(userInput),
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Request failed: ${response.status} ${errorText}`.trim());
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Model returned empty content.');
    }
    return content.trim();
  }

  async function handleSend() {
    if (isSending) return;

    const input = document.getElementById('commentbot-input');
    if (!input) return;

    const userInput = input.value.trim();
    if (!userInput) return;

    isSending = true;
    setBusyState();

    panelMessages.push({ role: 'user', content: userInput });
    renderChatMessages();
    input.value = '';
    await persistState();

    try {
      const reply = await requestAdvice(userInput);
      panelMessages.push({ role: 'assistant', content: reply });
    } catch (error) {
      panelMessages.push({
        role: 'assistant',
        content: `Error: ${error?.message || String(error)}`,
      });
    } finally {
      isSending = false;
      await persistState();
      renderChatMessages();
      setBusyState();
    }
  }

  function renderUI() {
    document.body.innerHTML = `
      <style>
        :root {
          color-scheme: dark;
        }
        body {
          margin: 0;
          font-family: ui-sans-serif, system-ui, sans-serif;
          background: #111827;
          color: #e5e7eb;
        }
        .commentbot-shell {
          height: 100vh;
          display: grid;
          grid-template-rows: auto auto 1fr auto;
          gap: 12px;
          padding: 16px;
          box-sizing: border-box;
          background: linear-gradient(180deg, #111827 0%, #0f172a 100%);
        }
        .commentbot-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
        }
        .commentbot-title {
          font-size: 18px;
          font-weight: 700;
        }
        .commentbot-subtitle {
          font-size: 12px;
          color: #94a3b8;
        }
        .commentbot-actions {
          display: flex;
          gap: 8px;
        }
        .commentbot-button {
          border: 1px solid #334155;
          background: #1e293b;
          color: #e2e8f0;
          border-radius: 10px;
          padding: 10px 14px;
          cursor: pointer;
        }
        .commentbot-button:hover {
          background: #334155;
        }
        .commentbot-button:disabled {
          opacity: 0.65;
          cursor: default;
        }
        .commentbot-sync {
          border: 1px solid #1e3a8a;
          background: rgba(30, 64, 175, 0.2);
          border-radius: 12px;
          padding: 10px 12px;
          font-size: 12px;
          color: #bfdbfe;
          white-space: pre-wrap;
        }
        .commentbot-messages {
          overflow-y: auto;
          border: 1px solid #334155;
          border-radius: 16px;
          padding: 12px;
          background: rgba(15, 23, 42, 0.8);
        }
        .commentbot-message {
          margin-bottom: 12px;
          padding: 12px;
          border-radius: 14px;
          max-width: min(90%, 820px);
          white-space: pre-wrap;
          word-break: break-word;
        }
        .commentbot-message.user {
          margin-left: auto;
          background: #1d4ed8;
        }
        .commentbot-message.assistant {
          margin-right: auto;
          background: #1f2937;
          border: 1px solid #374151;
        }
        .commentbot-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #cbd5e1;
          margin-bottom: 6px;
        }
        .commentbot-empty {
          color: #94a3b8;
          font-size: 13px;
        }
        .commentbot-input-row {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 10px;
        }
        .commentbot-input {
          width: 100%;
          min-height: 88px;
          resize: vertical;
          border: 1px solid #334155;
          border-radius: 14px;
          background: #020617;
          color: #e5e7eb;
          padding: 12px;
          box-sizing: border-box;
        }
      </style>
      <div class="commentbot-shell">
        <div class="commentbot-header">
          <div>
            <div class="commentbot-title">Comment Bot</div>
            <div class="commentbot-subtitle">Ask for summary, feedback, or writing suggestions about the current chat.</div>
          </div>
          <div class="commentbot-actions">
            <button id="commentbot-sync" class="commentbot-button">Sync</button>
            <button id="commentbot-close" class="commentbot-button">Close</button>
          </div>
        </div>
        <div id="commentbot-sync-info" class="commentbot-sync"></div>
        <div id="commentbot-messages" class="commentbot-messages"></div>
        <div class="commentbot-input-row">
          <textarea id="commentbot-input" class="commentbot-input" placeholder="Ask for a summary or feedback..."></textarea>
          <button id="commentbot-send" class="commentbot-button">Send</button>
        </div>
      </div>
    `;

    document.getElementById('commentbot-sync')?.addEventListener('click', async () => {
      await syncMessages();
    });
    document.getElementById('commentbot-close')?.addEventListener('click', async () => {
      await Risuai.hideContainer();
    });
    document.getElementById('commentbot-send')?.addEventListener('click', async () => {
      await handleSend();
    });
    document.getElementById('commentbot-input')?.addEventListener('keydown', async (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        await handleSend();
      }
    });

    renderSyncInfo();
    renderChatMessages();
    setBusyState();
  }

  try {
    await bootstrapState();

    await Risuai.registerButton(
      {
        name: 'Comment Bot',
        icon: '💬',
        iconType: 'html',
        location: 'chat',
      },
      async () => {
        renderUI();
        await syncMessages();
        await Risuai.showContainer('fullscreen');
      }
    );

    await Risuai.onUnload(async () => {
      await persistState();
    });

    console.log(`${PLUGIN_NAME} loaded`);
  } catch (error) {
    console.log(`${PLUGIN_NAME} failed to load: ${error?.message || String(error)}`);
  }
})();
