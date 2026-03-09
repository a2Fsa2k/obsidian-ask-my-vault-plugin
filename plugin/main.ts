import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, ItemView, MarkdownRenderer, TFile, Notice } from 'obsidian';

interface RAGChatSettings {
	provider: string;
	baseUrl: string;
	apiKey: string;
	model: string;
	temperature: number;
	systemPrompt: string;
	backendUrl: string;
	consentGiven: boolean;
	localLlmType: string;  // 'ollama' | 'llamacpp' | 'lmstudio' | 'openaicompat'
	localLlmUrl: string;
	localLlmModel: string;
}

const DEFAULT_SETTINGS: RAGChatSettings = {
	provider: 'openai',
	baseUrl: 'https://api.openai.com',
	apiKey: '',
	model: 'gpt-4o',
	temperature: 0.7,
	systemPrompt: 'You are a helpful assistant. Answer questions based on the provided context from the user\'s knowledge base.',
	backendUrl: 'http://localhost:8000',
	consentGiven: false,
	localLlmType: 'ollama',
	localLlmUrl: 'http://localhost:11434',
	localLlmModel: 'llama3'
};

// Providers with their base URLs and default models
const PROVIDERS: Record<string, { url: string; model: string; label: string; needsKey: boolean }> = {
	'openai':     { url: 'https://api.openai.com',                         model: 'gpt-4o',                      label: 'OpenAI',                   needsKey: true  },
	'anthropic':  { url: 'https://api.anthropic.com',                      model: 'claude-3-5-sonnet-20241022',   label: 'Anthropic (Claude)',        needsKey: true  },
	'google':     { url: 'https://generativelanguage.googleapis.com',       model: 'gemini-2.0-flash',            label: 'Google Gemini',             needsKey: true  },
	'mistral':    { url: 'https://api.mistral.ai',                         model: 'mistral-large-latest',         label: 'Mistral',                  needsKey: true  },
	'groq':       { url: 'https://api.groq.com/openai',                    model: 'llama-3.3-70b-versatile',     label: 'Groq (fast inference)',     needsKey: true  },
	'xai':        { url: 'https://api.x.ai',                               model: 'grok-2-latest',               label: 'xAI (Grok)',               needsKey: true  },
	'deepseek':   { url: 'https://api.deepseek.com',                       model: 'deepseek-chat',               label: 'DeepSeek',                 needsKey: true  },
	'cohere':     { url: 'https://api.cohere.com',                         model: 'command-r-plus-08-2024',       label: 'Cohere',                   needsKey: true  },
	'together':   { url: 'https://api.together.xyz',                       model: 'meta-llama/Llama-3-70b-chat-hf', label: 'Together AI',            needsKey: true  },
	'perplexity': { url: 'https://api.perplexity.ai',                      model: 'llama-3.1-sonar-large-128k-online', label: 'Perplexity',          needsKey: true  },
	'local':      { url: 'http://localhost:11434',                          model: 'llama3',                      label: 'Local LLM',                needsKey: false },
	'custom':     { url: '',                                                model: '',                            label: 'Custom (OpenAI-compat)',    needsKey: false },
};

const LOCAL_LLM_TYPES: Record<string, { label: string; defaultUrl: string; defaultModel: string; hint: string }> = {
	'ollama':       { label: 'Ollama',                defaultUrl: 'http://localhost:11434', defaultModel: 'llama3',   hint: 'Run: ollama serve' },
	'llamacpp':     { label: 'llama.cpp server',       defaultUrl: 'http://localhost:8080',  defaultModel: 'local',    hint: 'Run: ./llama-server -m model.gguf --port 8080' },
	'lmstudio':     { label: 'LM Studio',              defaultUrl: 'http://localhost:1234',  defaultModel: 'local',    hint: 'Start server in LM Studio app' },
	'jan':          { label: 'Jan',                    defaultUrl: 'http://localhost:1337',  defaultModel: 'local',    hint: 'Start server in Jan app' },
	'openaicompat': { label: 'Other (OpenAI-compat)',  defaultUrl: 'http://localhost:8080',  defaultModel: 'local',    hint: 'Any server with /v1/chat/completions' },
};

const VIEW_TYPE_RAG_CHAT = 'rag-chat-view';

interface Message {
	role: 'user' | 'assistant';
	content: string;
	sources?: Array<{ file_path: string; snippet: string }>;
}

class RAGChatView extends ItemView {
	plugin: RAGChatPlugin;
	messages: Message[] = [];
	inputEl: HTMLTextAreaElement;
	messagesContainer: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: RAGChatPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_RAG_CHAT;
	}

	getDisplayText(): string {
		return 'RAG Chat';
	}

	getIcon(): string {
		return 'message-circle';
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('rag-chat-view');

		// Messages container
		this.messagesContainer = container.createDiv({ cls: 'rag-chat-messages' });

		// Input container
		const inputContainer = container.createDiv({ cls: 'rag-chat-input-container' });
		const inputWrapper = inputContainer.createDiv({ cls: 'rag-chat-input-wrapper' });
		
		this.inputEl = inputWrapper.createEl('textarea', {
			cls: 'rag-chat-input',
			attr: { 
				placeholder: 'Ask a question about your notes...',
				rows: '1'
			}
		});

		const sendButton = inputWrapper.createEl('button', {
			text: 'Send',
			cls: 'rag-chat-send-button'
		});

		// Auto-resize textarea
		this.inputEl.addEventListener('input', () => {
			this.inputEl.style.height = 'auto';
			this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 200) + 'px';
		});

		sendButton.addEventListener('click', () => this.sendMessage());
		this.inputEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this.sendMessage();
			}
		});

		this.renderMessages();
	}

	async onClose() {
		// Cleanup
	}

	addStyles() {
		// Styles are now loaded from styles.css
	}

	async sendMessage() {
		const question = this.inputEl.value.trim();
		if (!question) return;

		if (!this.plugin.settings.consentGiven) {
			new Notice('Please accept the consent in settings before using the chat');
			return;
		}

		const isLocal = this.plugin.settings.provider === 'local';
		const providerInfo = PROVIDERS[this.plugin.settings.provider];
		if (!isLocal && providerInfo?.needsKey && !this.plugin.settings.apiKey) {
			new Notice('Please configure an API key in Settings → RAG Chat');
			return;
		}

		// Add user message
		this.messages.push({ role: 'user', content: question });
		this.renderMessages();
		this.inputEl.value = '';

		// Show loading
		const loadingMsg: Message = { role: 'assistant', content: '...' };
		this.messages.push(loadingMsg);
		this.renderMessages();

		try {
			const provider = this.plugin.settings.provider;
			const baseUrl = provider === 'local'
				? this.plugin.settings.localLlmUrl
				: this.plugin.settings.baseUrl;
			const model = provider === 'local'
				? this.plugin.settings.localLlmModel
				: this.plugin.settings.model;
			// Pass local LLM type so backend knows which API format to use
			const localLlmType = provider === 'local' ? this.plugin.settings.localLlmType : '';

			const response = await fetch(`${this.plugin.settings.backendUrl}/query`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					question,
					provider,
					base_url: baseUrl,
					api_key: this.plugin.settings.apiKey,
					model: model,
					temperature: this.plugin.settings.temperature,
					system_prompt: this.plugin.settings.systemPrompt,
					local_llm_type: localLlmType,
					top_k: 5
				})
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${await response.text()}`);
			}

			const data = await response.json();

			// Replace loading message
			this.messages.pop();
			this.messages.push({
				role: 'assistant',
				content: data.answer,
				sources: data.sources
			});
			this.renderMessages();

		} catch (error) {
			this.messages.pop();
			this.messages.push({
				role: 'assistant',
				content: `Error: ${error.message}`
			});
			this.renderMessages();
			new Notice(`Query failed: ${error.message}`);
		}
	}

	renderMessages() {
		this.messagesContainer.empty();

		if (this.messages.length === 0) {
			const emptyState = this.messagesContainer.createDiv({ cls: 'rag-chat-empty' });
			emptyState.createDiv({ cls: 'rag-chat-empty-icon', text: '💬' });
			emptyState.createDiv({ cls: 'rag-chat-empty-title', text: 'Start a conversation' });
			emptyState.createDiv({ cls: 'rag-chat-empty-subtitle', text: 'Ask questions about your notes and get AI-powered answers with sources.' });
			return;
		}

		for (const msg of this.messages) {
			const msgDiv = this.messagesContainer.createDiv({ cls: `rag-chat-message ${msg.role}` });
			
			// Avatar
			const avatar = msgDiv.createDiv({ cls: 'rag-chat-avatar' });
			avatar.setText(msg.role === 'user' ? '👤' : '🤖');

			// Content wrapper
			const contentWrapper = msgDiv.createDiv({ cls: 'rag-chat-content' });

			// Message bubble
			const bubble = contentWrapper.createDiv({ cls: 'rag-chat-bubble' });
			
			if (msg.content === '...') {
				// Loading animation
				const loading = bubble.createDiv({ cls: 'rag-chat-loading' });
				loading.createDiv({ cls: 'rag-chat-loading-dot' });
				loading.createDiv({ cls: 'rag-chat-loading-dot' });
				loading.createDiv({ cls: 'rag-chat-loading-dot' });
			} else {
				MarkdownRenderer.renderMarkdown(msg.content, bubble, '', this.plugin);
			}

			// Sources
			if (msg.sources && msg.sources.length > 0) {
				const sourcesDiv = contentWrapper.createDiv({ cls: 'rag-chat-sources' });
				sourcesDiv.createDiv({ cls: 'rag-chat-source-label', text: '📚 Sources' });
				
				for (const source of msg.sources) {
					const sourceItem = sourcesDiv.createDiv({ cls: 'rag-chat-source-item' });
					
					// Extract filename from path
					const fileName = source.file_path.split('/').pop() || source.file_path;
					sourceItem.createDiv({ cls: 'rag-chat-source-file', text: fileName });
					sourceItem.createDiv({ cls: 'rag-chat-source-snippet', text: source.snippet });
					
					sourceItem.addEventListener('click', async () => {
						await this.openFile(source.file_path);
					});
				}
			}
		}

		// Auto-scroll to bottom
		this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
	}

	async openFile(filePath: string) {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (file instanceof TFile) {
			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(file);
		} else {
			new Notice(`File not found: ${filePath}`);
		}
	}
}

export default class RAGChatPlugin extends Plugin {
	settings: RAGChatSettings;
	indexingDebounceTimer: NodeJS.Timeout | null = null;
	isInitialIndexComplete: boolean = false;

	async onload() {
		await this.loadSettings();

		// Register view
		this.registerView(
			VIEW_TYPE_RAG_CHAT,
			(leaf) => new RAGChatView(leaf, this)
		);

		// Add ribbon icon
		this.addRibbonIcon('message-circle', 'Open RAG Chat', () => {
			this.activateView();
		});

		// Add command
		this.addCommand({
			id: 'open-rag-chat',
			name: 'Open RAG Chat',
			callback: () => {
				this.activateView();
			}
		});

		// Settings tab
		this.addSettingTab(new RAGChatSettingTab(this.app, this));

		// Watch for file changes
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file instanceof TFile && file.extension === 'md') {
					this.scheduleIndexing(file);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on('create', (file) => {
				if (file instanceof TFile && file.extension === 'md') {
					this.scheduleIndexing(file);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (file instanceof TFile && file.extension === 'md') {
					this.deleteFromIndex(file.path);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (file instanceof TFile && file.extension === 'md') {
					this.deleteFromIndex(oldPath);
					this.scheduleIndexing(file);
				}
			})
		);

		// Auto-index vault on first load if needed
		this.autoIndexVault();
	}

	async activateView() {
		const { workspace } = this.app;
		
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_RAG_CHAT)[0];
		
		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				await rightLeaf.setViewState({
					type: VIEW_TYPE_RAG_CHAT,
					active: true,
				});
				leaf = rightLeaf;
			}
		}
		
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	scheduleIndexing(file: TFile) {
		if (this.indexingDebounceTimer) {
			clearTimeout(this.indexingDebounceTimer);
		}

		this.indexingDebounceTimer = setTimeout(async () => {
			await this.indexFile(file);
		}, 1000);
	}

	async indexFile(file: TFile) {
		try {
			const content = await this.app.vault.read(file);
			await fetch(`${this.settings.backendUrl}/index`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					file_path: file.path,
					content: content
				})
			});
		} catch (error) {
			console.error('Failed to index file:', error);
		}
	}

	async deleteFromIndex(filePath: string) {
		try {
			await fetch(`${this.settings.backendUrl}/index/${encodeURIComponent(filePath)}`, {
				method: 'DELETE'
			});
		} catch (error) {
			console.error('Failed to delete file from index:', error);
		}
	}

	async autoIndexVault() {
		// Check if vault needs initial indexing
		try {
			const response = await fetch(`${this.settings.backendUrl}/status`);
			if (!response.ok) return;
			
			const status = await response.json();
			
			// If no files indexed, do initial index
			if (status.indexed_files === 0) {
				const mdFiles = this.app.vault.getMarkdownFiles();
				if (mdFiles.length > 0) {
					new Notice(`Indexing ${mdFiles.length} notes... This may take a moment.`);
					
					let indexed = 0;
					for (const file of mdFiles) {
						await this.indexFile(file);
						indexed++;
					}
					
					this.isInitialIndexComplete = true;
					new Notice(`✅ Indexed ${indexed} notes successfully!`);
				}
			} else {
				this.isInitialIndexComplete = true;
			}
		} catch (error) {
			console.error('Auto-index failed:', error);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class RAGChatSettingTab extends PluginSettingTab {
	plugin: RAGChatPlugin;

	constructor(app: App, plugin: RAGChatPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'RAG Chat Settings' });

		// ── Backend ──────────────────────────────────────────────────────────
		containerEl.createEl('h3', { text: '🖥️ Backend' });

		new Setting(containerEl)
			.setName('Backend URL')
			.setDesc('URL of the RAG backend server (must be running locally)')
			.addText(text => text
				.setPlaceholder('http://localhost:8000')
				.setValue(this.plugin.settings.backendUrl)
				.onChange(async (value) => {
					this.plugin.settings.backendUrl = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Test connection')
			.setDesc('Verify the backend is reachable')
			.addButton(button => button
				.setButtonText('Test')
				.onClick(async () => {
					button.setDisabled(true);
					try {
						const r = await fetch(`${this.plugin.settings.backendUrl}/health`);
						if (r.ok) new Notice('✅ Backend is reachable');
						else new Notice(`❌ Backend returned HTTP ${r.status}`);
					} catch {
						new Notice('❌ Cannot reach backend. Is it running?\n\nRun: cd backend && python main.py');
					} finally {
						button.setDisabled(false);
					}
				}));

		// ── AI Provider ──────────────────────────────────────────────────────
		containerEl.createEl('h3', { text: '🤖 AI Provider' });

		const providerDropdown = new Setting(containerEl)
			.setName('Provider')
			.setDesc('Select the AI provider to use')
			.addDropdown(dropdown => {
				for (const [key, info] of Object.entries(PROVIDERS)) {
					dropdown.addOption(key, info.label);
				}
				dropdown.setValue(this.plugin.settings.provider);
				dropdown.onChange(async (value) => {
					this.plugin.settings.provider = value;
					if (value !== 'custom' && value !== 'local') {
						this.plugin.settings.baseUrl = PROVIDERS[value].url;
						this.plugin.settings.model = PROVIDERS[value].model;
					}
					await this.plugin.saveSettings();
					this.display();
				});
				return dropdown;
			});

		const isLocal = this.plugin.settings.provider === 'local';
		const isCustom = this.plugin.settings.provider === 'custom';
		const providerInfo = PROVIDERS[this.plugin.settings.provider];

		if (!isLocal) {
			// Base URL — editable only for custom
			new Setting(containerEl)
				.setName('Base URL')
				.setDesc('API base URL (auto-filled for known providers)')
				.addText(text => {
					const t = text
						.setPlaceholder('https://api.openai.com')
						.setValue(this.plugin.settings.baseUrl)
						.onChange(async (value) => {
							this.plugin.settings.baseUrl = value.trim();
							await this.plugin.saveSettings();
						});
					if (!isCustom) t.setDisabled(true);
					return t;
				});

			// API Key
			if (isCustom || providerInfo?.needsKey) {
				new Setting(containerEl)
					.setName('API Key')
					.setDesc('Your API key for the selected provider')
					.addText(text => {
						text
							.setPlaceholder('sk-...')
							.setValue(this.plugin.settings.apiKey)
							.onChange(async (value) => {
								this.plugin.settings.apiKey = value.trim();
								await this.plugin.saveSettings();
							});
						text.inputEl.type = 'password';
						return text;
					});
			}

			// Model
			new Setting(containerEl)
				.setName('Model')
				.setDesc('Model name (auto-filled, change as needed)')
				.addText(text => text
					.setPlaceholder(providerInfo?.model ?? 'model-name')
					.setValue(this.plugin.settings.model)
					.onChange(async (value) => {
						this.plugin.settings.model = value.trim();
						await this.plugin.saveSettings();
					}));
		}

		// ── Local LLM ────────────────────────────────────────────────────────
		if (isLocal) {
			containerEl.createEl('h3', { text: '🏠 Local LLM Settings' });

			new Setting(containerEl)
				.setName('Local LLM type')
				.setDesc('Which local server are you running?')
				.addDropdown(dropdown => {
					for (const [key, info] of Object.entries(LOCAL_LLM_TYPES)) {
						dropdown.addOption(key, info.label);
					}
					dropdown.setValue(this.plugin.settings.localLlmType);
					dropdown.onChange(async (value) => {
						this.plugin.settings.localLlmType = value;
						this.plugin.settings.localLlmUrl = LOCAL_LLM_TYPES[value].defaultUrl;
						this.plugin.settings.localLlmModel = LOCAL_LLM_TYPES[value].defaultModel;
						await this.plugin.saveSettings();
						this.display();
					});
					return dropdown;
				});

			const localInfo = LOCAL_LLM_TYPES[this.plugin.settings.localLlmType];
			if (localInfo) {
				containerEl.createEl('p', {
					text: `💡 ${localInfo.hint}`,
					cls: 'setting-item-description'
				});
			}

			new Setting(containerEl)
				.setName('Local server URL')
				.setDesc('Full URL including port')
				.addText(text => text
					.setPlaceholder(localInfo?.defaultUrl ?? 'http://localhost:11434')
					.setValue(this.plugin.settings.localLlmUrl)
					.onChange(async (value) => {
						this.plugin.settings.localLlmUrl = value.trim();
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('Model name')
				.setDesc('Model to use (e.g. llama3, mistral, phi3)')
				.addText(text => text
					.setPlaceholder(localInfo?.defaultModel ?? 'llama3')
					.setValue(this.plugin.settings.localLlmModel)
					.onChange(async (value) => {
						this.plugin.settings.localLlmModel = value.trim();
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('Test local LLM')
				.setDesc('Check if the local server is reachable')
				.addButton(button => button
					.setButtonText('Test')
					.onClick(async () => {
						button.setDisabled(true);
						const url = this.plugin.settings.localLlmUrl;
						try {
							// Ollama has /api/tags, others have /v1/models or just /health
							const endpoints = ['/api/tags', '/v1/models', '/health'];
							let reachable = false;
							for (const ep of endpoints) {
								try {
									const r = await fetch(url + ep);
									if (r.ok || r.status < 500) { reachable = true; break; }
								} catch {}
							}
							if (reachable) {
								new Notice(`✅ Local LLM server is reachable at ${url}`);
							} else {
								new Notice(`❌ Server at ${url} is not responding.\n\n${localInfo?.hint ?? ''}`);
							}
						} catch {
							new Notice(`❌ Cannot reach ${url}\n\n${localInfo?.hint ?? 'Is the server running?'}`);
						} finally {
							button.setDisabled(false);
						}
					}));
		}

		// ── Generation ───────────────────────────────────────────────────────
		containerEl.createEl('h3', { text: '⚙️ Generation' });

		new Setting(containerEl)
			.setName('Temperature')
			.setDesc('Controls randomness: 0 = focused, 1 = creative')
			.addSlider(slider => slider
				.setLimits(0, 1, 0.1)
				.setValue(this.plugin.settings.temperature)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.temperature = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('System Prompt')
			.setDesc('Instructions for the AI assistant')
			.addTextArea(text => text
				.setPlaceholder('You are a helpful assistant...')
				.setValue(this.plugin.settings.systemPrompt)
				.onChange(async (value) => {
					this.plugin.settings.systemPrompt = value;
					await this.plugin.saveSettings();
				})
				.inputEl.rows = 4);

		// ── Privacy & Index ──────────────────────────────────────────────────
		containerEl.createEl('h3', { text: '🔒 Privacy & Index' });

		new Setting(containerEl)
			.setName('Data consent')
			.setDesc('I understand that my vault content may be sent to external AI APIs when using cloud providers')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.consentGiven)
				.onChange(async (value) => {
					this.plugin.settings.consentGiven = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Rebuild Index')
			.setDesc('Re-index all notes in your vault (safe to run at any time)')
			.addButton(button => button
				.setButtonText('Rebuild')
				.onClick(async () => {
					button.setDisabled(true);
					button.setButtonText('Rebuilding...');
					try {
						const vaultPath = (this.app.vault.adapter as any).basePath;
						const response = await fetch(`${this.plugin.settings.backendUrl}/rebuild`, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ vault_path: vaultPath })
						});
						if (response.ok) {
							const data = await response.json();
							new Notice(`✅ Index rebuilt: ${data.indexed_files} files, ${data.total_chunks} chunks`);
						} else {
							const err = await response.text();
							throw new Error(err);
						}
					} catch (error) {
						new Notice(`❌ Rebuild failed: ${error.message}`);
					} finally {
						button.setDisabled(false);
						button.setButtonText('Rebuild');
					}
				}));
	}
}
