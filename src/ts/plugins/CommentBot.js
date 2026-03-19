//@name CommentBot
//@display-name Comment Bot
//@api 3.0
//@version 1.1.0
//@description A side-chat panel for asking advice about the current chat history
//@arg api_url string OpenAI-compatible chat completions endpoint URL
//@arg api_key string API key for the advice model
//@arg model string Model name for the advice model
//@arg system_prompt string System prompt for the advice assistant
//@arg max_sync_messages int Maximum synced messages from the current chat
//@arg history_role string Role for synced chat history: user or system
//@arg include_character_context int Include note/persona/lorebook context: 1 or 0
//@arg max_lore_entries int Maximum lore entries to include in context

(async () => {
  const PLUGIN_NAME = 'CommentBot';
  const STORAGE_KEYS = {
    syncTranscript: 'syncTranscript',
    syncContext: 'syncContext',
    panelMessages: 'panelMessages',
  };

  const DEFAULTS = {
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    systemPrompt:
      'You are a chat reviewer. Answer only based on the synced conversation and the user question. Give practical suggestions, feedback, and concise summaries.',
    maxSyncMessages: 50,
    historyRole: 'user',
    includeCharacterContext: 1,
    maxLoreEntries: 8,
  };

  let syncedTranscript = '';
  let syncedContext = '';
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
    await Risuai.pluginStorage.setItem(STORAGE_KEYS.syncContext, syncedContext);
    await Risuai.pluginStorage.setItem(STORAGE_KEYS.panelMessages, JSON.stringify(panelMessages));
  }

  async function bootstrapState() {
    syncedTranscript = (await Risuai.pluginStorage.getItem(STORAGE_KEYS.syncTranscript)) ?? '';
    syncedContext = (await Risuai.pluginStorage.getItem(STORAGE_KEYS.syncContext)) ?? '';
    panelMessages = loadPanelMessages(await Risuai.pluginStorage.getItem(STORAGE_KEYS.panelMessages));
  }

  function extractLoreText(entry) {
    if (!entry || typeof entry !== 'object') return '';

    const title = entry.comment || entry.name || entry.title || '';
    const content =
      entry.content ||
      entry.text ||
      entry.value ||
      entry.prompt ||
      entry.description ||
      '';

    const keywords = Array.isArray(entry.key)
      ? entry.key
      : Array.isArray(entry.keys)
        ? entry.keys
        : Array.isArray(entry.keywords)
          ? entry.keywords
          : [];

    const parts = [];
    if (title) {
      parts.push(`Title: ${String(title).trim()}`);
    }
    if (keywords.length > 0) {
      parts.push(`Keywords: ${keywords.map((item) => String(item).trim()).filter(Boolean).join(', ')}`);
    }
    if (content) {
      parts.push(`Content: ${String(content).trim()}`);
    }
    return parts.join('\n');
  }

  async function getCharacterContext(character, chat) {
    const includeCharacterContext = Number(await Risuai.getArgument('include_character_context'));
    if ((Number.isNaN(includeCharacterContext) ? DEFAULTS.includeCharacterContext : includeCharacterContext) !== 1) {
      return '';
    }

    const hasDbPermission = await Risuai.requestPluginPermission('db');
    if (!hasDbPermission) {
      return '';
    }

    const db = await Risuai.getDatabase(['personas', 'selectedPersona', 'personaPrompt', 'username']);
    const sections = [];

    if (character?.description) {
      sections.push(`[Character Description]\n${String(character.description).trim()}`);
    }
    if (character?.personality) {
      sections.push(`[Character Personality]\n${String(character.personality).trim()}`);
    }
    if (character?.scenario) {
      sections.push(`[Character Scenario]\n${String(character.scenario).trim()}`);
    }
    if (chat?.note) {
      sections.push(`[Author Note]\n${String(chat.note).trim()}`);
    }

    let personaPrompt = '';
    if (chat?.bindedPersona && Array.isArray(db?.personas)) {
      const bindedPersona = db.personas.find((persona) => persona?.id === chat.bindedPersona);
      personaPrompt = bindedPersona?.personaPrompt || '';
    }
    if (!personaPrompt) {
      personaPrompt = db?.personaPrompt || '';
    }
    if (personaPrompt) {
      sections.push(`[User Persona]\n${String(personaPrompt).trim()}`);
    }

    const maxLoreEntries = Number(await Risuai.getArgument('max_lore_entries')) || DEFAULTS.maxLoreEntries;
    const loreEntries = [...(chat?.localLore ?? []), ...(character?.globalLore ?? [])]
      .map(extractLoreText)
      .filter(Boolean)
      .slice(0, maxLoreEntries);

    if (loreEntries.length > 0) {
      sections.push(`[Lorebook]\n${loreEntries.join('\n\n')}`);
    }

    return sections.join('\n\n').trim();
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
    const contextState = syncedContext ? ' Character context included.' : '';
    syncInfo.textContent = `Synced ${lineCount} lines from the current chat.${contextState}`;
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

    if (character?.type === 'group') {
      syncedTranscript = '';
      syncedContext = '';
      await persistState();
      renderSyncInfo();
      throw new Error('Group characters are not supported by CommentBot.');
    }

    if (!chat || !Array.isArray(chat.message)) {
      syncedTranscript = '';
      syncedContext = '';
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
    syncedContext = await getCharacterContext(character, chat);
    await persistState();
    renderSyncInfo();
  }

  async function buildRequestMessages(userInput) {
    const systemPrompt = String((await Risuai.getArgument('system_prompt')) || DEFAULTS.systemPrompt).trim();
    const historyRoleRaw = String((await Risuai.getArgument('history_role')) || DEFAULTS.historyRole).trim().toLowerCase();
    const historyRole = historyRoleRaw === 'system' ? 'system' : 'user';
    const messages = [{ role: 'system', content: systemPrompt }];

    if (syncedContext) {
      messages.push({
        role: 'system',
        content: `[Character context]\n${syncedContext}`,
      });
    }

    if (syncedTranscript) {
      messages.push({
        role: historyRole,
        content: `[Synced chat history]\n${syncedTranscript}`,
      });
    }

    for (const message of panelMessages) {
      messages.push({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.content,
      });
    }

    messages.push({
      role: 'user',
      content: userInput,
    });

    return messages;
  }

  async function requestAdvice(userInput) {
    const apiUrl = String((await Risuai.getArgument('api_url')) || DEFAULTS.apiUrl).trim();
    const apiKey = String((await Risuai.getArgument('api_key')) || '').trim();
    const model = String((await Risuai.getArgument('model')) || '').trim();

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
        messages: await buildRequestMessages(userInput),
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

  async function renderUI() {
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
        .commentbot-options {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          align-items: center;
          font-size: 12px;
          color: #cbd5e1;
        }
        .commentbot-options label {
          display: inline-flex;
          gap: 6px;
          align-items: center;
        }
        .commentbot-select {
          border: 1px solid #334155;
          border-radius: 8px;
          background: #0f172a;
          color: #e5e7eb;
          padding: 6px 8px;
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
        <div class="commentbot-options">
          <label>
            History role
            <select id="commentbot-history-role" class="commentbot-select">
              <option value="user">user</option>
              <option value="system">system</option>
            </select>
          </label>
          <label>
            <input id="commentbot-include-context" type="checkbox" />
            Include character context
          </label>
        </div>
        <div class="commentbot-input-row">
          <textarea id="commentbot-input" class="commentbot-input" placeholder="Ask for a summary or feedback..."></textarea>
          <button id="commentbot-send" class="commentbot-button">Send</button>
        </div>
      </div>
    `;

    const historyRoleSelect = document.getElementById('commentbot-history-role');
    if (historyRoleSelect) {
      historyRoleSelect.value = String((await Risuai.getArgument('history_role')) || DEFAULTS.historyRole).trim().toLowerCase() === 'system'
        ? 'system'
        : 'user';
      historyRoleSelect.addEventListener('change', async (event) => {
        const value = event?.target?.value === 'system' ? 'system' : 'user';
        await Risuai.setArgument('history_role', value);
      });
    }

    const includeContextCheckbox = document.getElementById('commentbot-include-context');
    if (includeContextCheckbox) {
      includeContextCheckbox.checked =
        (Number(await Risuai.getArgument('include_character_context')) || DEFAULTS.includeCharacterContext) === 1;
      includeContextCheckbox.addEventListener('change', async (event) => {
        const checked = event?.target?.checked ? 1 : 0;
        await Risuai.setArgument('include_character_context', checked);
        await syncMessages().catch(async (error) => {
          panelMessages.push({
            role: 'assistant',
            content: `Error: ${error?.message || String(error)}`,
          });
          await persistState();
          renderChatMessages();
        });
      });
    }

    document.getElementById('commentbot-sync')?.addEventListener('click', async () => {
      await syncMessages().catch(async (error) => {
        panelMessages.push({
          role: 'assistant',
          content: `Error: ${error?.message || String(error)}`,
        });
        await persistState();
        renderChatMessages();
      });
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
        await renderUI();
        await syncMessages().catch(async (error) => {
          panelMessages.push({
            role: 'assistant',
            content: `Error: ${error?.message || String(error)}`,
          });
          await persistState();
        });
        renderChatMessages();
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
