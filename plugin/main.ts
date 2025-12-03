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
	enableLocalLLM: boolean;
}

const DEFAULT_SETTINGS: RAGChatSettings = {
	provider: 'openai',
	baseUrl: 'https://api.openai.com',
	apiKey: '',
	model: 'gpt-4',
	temperature: 0.7,
	systemPrompt: 'You are a helpful assistant. Answer questions based on the provided context from the user\'s knowledge base.',
	backendUrl: 'http://localhost:8000',
	consentGiven: false,
	enableLocalLLM: false
};

const PROVIDER_BASE_URLS: Record<string, string> = {
	'openai': 'https://api.openai.com',
	'anthropic': 'https://api.anthropic.com',
	'google': 'https://generativelanguage.googleapis.com',
	'mistral': 'https://api.mistral.ai',
	'custom': '',
	'local': 'http://localhost:8080'
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

		if (!this.plugin.settings.apiKey && !this.plugin.settings.enableLocalLLM) {
			new Notice('Please configure API key in settings');
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
			const provider = this.plugin.settings.enableLocalLLM ? 'local' : this.plugin.settings.provider;
			const baseUrl = this.plugin.settings.enableLocalLLM 
				? PROVIDER_BASE_URLS['local'] 
				: this.plugin.settings.baseUrl;

			const response = await fetch(`${this.plugin.settings.backendUrl}/query`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					question,
					provider,
					base_url: baseUrl,
					api_key: this.plugin.settings.apiKey,
					model: this.plugin.settings.model,
					temperature: this.plugin.settings.temperature,
					system_prompt: this.plugin.settings.systemPrompt,
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

		// Backend URL
		new Setting(containerEl)
			.setName('Backend URL')
			.setDesc('URL of the RAG backend server')
			.addText(text => text
				.setPlaceholder('http://localhost:8000')
				.setValue(this.plugin.settings.backendUrl)
				.onChange(async (value) => {
					this.plugin.settings.backendUrl = value;
					await this.plugin.saveSettings();
				}));

		// Provider
		new Setting(containerEl)
			.setName('AI Provider')
			.setDesc('Select the AI provider to use')
			.addDropdown(dropdown => dropdown
				.addOption('openai', 'OpenAI')
				.addOption('anthropic', 'Anthropic (Claude)')
				.addOption('google', 'Google Gemini')
				.addOption('mistral', 'Mistral')
				.addOption('custom', 'Custom (OpenAI-compatible)')
				.setValue(this.plugin.settings.provider)
				.onChange(async (value) => {
					this.plugin.settings.provider = value;
					if (value !== 'custom') {
						this.plugin.settings.baseUrl = PROVIDER_BASE_URLS[value];
					}
					await this.plugin.saveSettings();
					this.display();
				}));

		// Base URL
		const baseUrlSetting = new Setting(containerEl)
			.setName('Base URL')
			.setDesc('API endpoint base URL')
			.addText(text => {
				const input = text
					.setPlaceholder('https://api.openai.com')
					.setValue(this.plugin.settings.baseUrl)
					.onChange(async (value) => {
						this.plugin.settings.baseUrl = value;
						await this.plugin.saveSettings();
					});
				
				if (this.plugin.settings.provider !== 'custom') {
					input.setDisabled(true);
				}
				
				return input;
			});

		// API Key
		new Setting(containerEl)
			.setName('API Key')
			.setDesc('Your API key for the selected provider')
			.addText(text => text
				.setPlaceholder('sk-...')
				.setValue(this.plugin.settings.apiKey)
				.onChange(async (value) => {
					this.plugin.settings.apiKey = value;
					await this.plugin.saveSettings();
				})
				.inputEl.type = 'password');

		// Model Name
		new Setting(containerEl)
			.setName('Model Name')
			.setDesc('The model to use (e.g., gpt-4, claude-3-opus-20240229, gemini-pro)')
			.addText(text => text
				.setPlaceholder('gpt-4')
				.setValue(this.plugin.settings.model)
				.onChange(async (value) => {
					this.plugin.settings.model = value;
					await this.plugin.saveSettings();
				}));

		// Temperature
		new Setting(containerEl)
			.setName('Temperature')
			.setDesc('Controls randomness (0-1)')
			.addSlider(slider => slider
				.setLimits(0, 1, 0.1)
				.setValue(this.plugin.settings.temperature)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.temperature = value;
					await this.plugin.saveSettings();
				}));

		// System Prompt
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

		// Local LLM toggle
		new Setting(containerEl)
			.setName('Enable Local LLM')
			.setDesc('Use local LLM server (llama.cpp at :8080 or Ollama at :11434)')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableLocalLLM)
				.onChange(async (value) => {
					this.plugin.settings.enableLocalLLM = value;
					await this.plugin.saveSettings();
				}));

		// Consent
		new Setting(containerEl)
			.setName('Data Consent')
			.setDesc('I understand that vault data may be sent to external APIs')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.consentGiven)
				.onChange(async (value) => {
					this.plugin.settings.consentGiven = value;
					await this.plugin.saveSettings();
				}));

		// Rebuild Index
		new Setting(containerEl)
			.setName('Rebuild Index')
			.setDesc('Rebuild the entire search index from your vault')
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
							new Notice(`✅ Index rebuilt! ${data.indexed_files} files, ${data.total_chunks} chunks`);
						} else {
							throw new Error(await response.text());
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
