import {
	App, Plugin, PluginSettingTab, Setting,
	WorkspaceLeaf, ItemView, MarkdownRenderer,
	TFile, Notice, requestUrl
} from 'obsidian';

// ─── Types ───────────────────────────────────────────────────────────────────

interface RAGChatSettings {
provider: string;
baseUrl: string;
apiKey: string;
model: string;
temperature: number;
systemPrompt: string;
consentGiven: boolean;
localLlmType: string;
localLlmUrl: string;
localLlmModel: string;
}

interface IndexEntry {
path: string;
mtime: number;
chunks: Chunk[];
}

interface Chunk {
text: string;
terms: Record<string, number>;
}

interface SearchResult {
filePath: string;
snippet: string;
score: number;
}

interface Message {
role: 'user' | 'assistant';
content: string;
sources?: SearchResult[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const VIEW_TYPE_RAG_CHAT = 'rag-chat-view';
const CHUNK_SIZE = 400;
const CHUNK_OVERLAP = 50;
const TOP_K = 5;

const DEFAULT_SETTINGS: RAGChatSettings = {
provider: 'openai',
baseUrl: 'https://api.openai.com',
apiKey: '',
model: 'gpt-4o',
temperature: 0.7,
systemPrompt: "You are a helpful assistant. Answer questions based on the provided context from the user's knowledge base. If the context doesn't contain enough information, say so.",
consentGiven: false,
localLlmType: 'ollama',
localLlmUrl: 'http://localhost:11434',
localLlmModel: 'llama3'
};

const PROVIDERS: Record<string, { url: string; model: string; label: string; needsKey: boolean }> = {
'openai':     { url: 'https://api.openai.com',                    model: 'gpt-4o',                           label: 'OpenAI',                needsKey: true  },
'anthropic':  { url: 'https://api.anthropic.com',                 model: 'claude-3-5-sonnet-20241022',        label: 'Anthropic (Claude)',     needsKey: true  },
'google':     { url: 'https://generativelanguage.googleapis.com', model: 'gemini-2.0-flash',                  label: 'Google Gemini',          needsKey: true  },
'mistral':    { url: 'https://api.mistral.ai',                    model: 'mistral-large-latest',              label: 'Mistral',               needsKey: true  },
'groq':       { url: 'https://api.groq.com/openai',               model: 'llama-3.3-70b-versatile',           label: 'Groq (fast)',           needsKey: true  },
'xai':        { url: 'https://api.x.ai',                          model: 'grok-2-latest',                     label: 'xAI (Grok)',            needsKey: true  },
'deepseek':   { url: 'https://api.deepseek.com',                  model: 'deepseek-chat',                     label: 'DeepSeek',              needsKey: true  },
'cohere':     { url: 'https://api.cohere.com',                    model: 'command-r-plus-08-2024',             label: 'Cohere',                needsKey: true  },
'together':   { url: 'https://api.together.xyz',                  model: 'meta-llama/Llama-3-70b-chat-hf',    label: 'Together AI',           needsKey: true  },
'perplexity': { url: 'https://api.perplexity.ai',                 model: 'llama-3.1-sonar-large-128k-online', label: 'Perplexity',            needsKey: true  },
'local':      { url: 'http://localhost:11434',                     model: 'llama3',                            label: 'Local llm',              needsKey: false },
'custom':     { url: '',                                           model: '',                                  label: 'Custom (OpenAI-compat)', needsKey: false },
};

const LOCAL_LLM_TYPES: Record<string, { label: string; defaultUrl: string; defaultModel: string; hint: string }> = {
'ollama':       { label: 'Ollama',                defaultUrl: 'http://localhost:11434', defaultModel: 'llama3', hint: 'Run: ollama serve' },
'llamacpp':     { label: 'llama.cpp server',      defaultUrl: 'http://localhost:8080',  defaultModel: 'local',  hint: 'Run: ./llama-server -m model.gguf --port 8080' },
'lmstudio':     { label: 'LM Studio',             defaultUrl: 'http://localhost:1234',  defaultModel: 'local',  hint: 'Start server in LM Studio app' },
'jan':          { label: 'Jan',                   defaultUrl: 'http://localhost:1337',  defaultModel: 'local',  hint: 'Start server in Jan app' },
'openaicompat': { label: 'Other (OpenAI-compat)', defaultUrl: 'http://localhost:8080',  defaultModel: 'local',  hint: 'Any server with /v1/chat/completions' },
};

// ─── BM25 Search Engine ───────────────────────────────────────────────────────

function tokenize(text: string): string[] {
return text
.toLowerCase()
.replace(/[^a-z0-9\s]/g, ' ')
.split(/\s+/)
.filter(t => t.length > 2);
}

function termFrequencies(tokens: string[]): Record<string, number> {
const tf: Record<string, number> = {};
for (const t of tokens) tf[t] = (tf[t] ?? 0) + 1;
const total = tokens.length || 1;
for (const t in tf) tf[t] /= total;
return tf;
}

function chunkText(text: string): string[] {
const words = text.split(/\s+/);
const chunks: string[] = [];
let i = 0;
while (i < words.length) {
chunks.push(words.slice(i, i + CHUNK_SIZE).join(' '));
i += CHUNK_SIZE - CHUNK_OVERLAP;
}
return chunks.filter(c => c.trim().length > 0);
}

function bm25Score(
queryTerms: string[],
chunkTerms: Record<string, number>,
chunkLen: number,
avgLen: number,
docFreq: Record<string, number>,
numDocs: number,
k1 = 1.5,
b = 0.75
): number {
let score = 0;
for (const term of queryTerms) {
const tf = chunkTerms[term] ?? 0;
if (tf === 0) continue;
const df = docFreq[term] ?? 0;
const idf = Math.log((numDocs - df + 0.5) / (df + 0.5) + 1);
const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (chunkLen / avgLen)));
score += idf * tfNorm;
}
return score;
}

// ─── LLM Caller ──────────────────────────────────────────────────────────────

async function callLLM(settings: RAGChatSettings, messages: Array<{ role: string; content: string }>): Promise<string> {
const provider = settings.provider;
const isLocal = provider === 'local';
const baseUrl = isLocal ? settings.localLlmUrl : settings.baseUrl;
const model = isLocal ? settings.localLlmModel : settings.model;
const apiKey = settings.apiKey;

if (provider === 'google') {
const geminiMessages = messages
.filter(m => m.role !== 'system')
.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
const systemMsg = messages.find(m => m.role === 'system');
const body: Record<string, unknown> = { contents: geminiMessages };
if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg.content }] };
const resp = await requestUrl({
url: `${baseUrl}/v1beta/models/${model}:generateContent?key=${apiKey}`,
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify(body),
throw: false
});
if (resp.status >= 400) throw new Error(`Gemini error ${resp.status}: ${resp.text}`);
return resp.json.candidates[0].content.parts[0].text as string;
}

if (provider === 'anthropic') {
const systemMsg = messages.find(m => m.role === 'system');
const anthropicMessages = messages.filter(m => m.role !== 'system');
const body: Record<string, unknown> = { model, max_tokens: 4096, messages: anthropicMessages };
if (systemMsg) body.system = systemMsg.content;
const resp = await requestUrl({
url: `${baseUrl}/v1/messages`,
method: 'POST',
headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
body: JSON.stringify(body),
throw: false
});
if (resp.status >= 400) throw new Error(`Anthropic error ${resp.status}: ${resp.text}`);
return resp.json.content[0].text as string;
}

if (isLocal && settings.localLlmType === 'ollama') {
const resp = await requestUrl({
url: `${baseUrl}/api/chat`,
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ model, messages, stream: false }),
throw: false
});
if (resp.status >= 400) throw new Error(`Ollama error ${resp.status}: ${resp.text}`);
return resp.json.message.content as string;
}

const headers: Record<string, string> = { 'Content-Type': 'application/json' };
if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
const resp = await requestUrl({
url: `${baseUrl}/v1/chat/completions`,
method: 'POST',
headers,
body: JSON.stringify({ model, messages, temperature: settings.temperature }),
throw: false
});
if (resp.status >= 400) throw new Error(`API error ${resp.status}: ${resp.text}`);
return resp.json.choices[0].message.content as string;
}

// ─── Index Manager ────────────────────────────────────────────────────────────

class VaultIndex {
private entries: Map<string, IndexEntry> = new Map();
private docFreq: Record<string, number> = {};
private avgChunkLen = 0;
private plugin: RAGChatPlugin;

constructor(plugin: RAGChatPlugin) {
this.plugin = plugin;
}

async load(): Promise<void> {
try {
const raw = await this.plugin.loadData();
if (raw?.index) {
for (const e of raw.index as IndexEntry[]) this.entries.set(e.path, e);
this.recomputeStats();
}
} catch { /* fresh index */ }
}

async save(): Promise<void> {
const existing = (await this.plugin.loadData()) ?? {};
await this.plugin.saveData({ ...existing, index: Array.from(this.entries.values()) });
}

async indexFile(file: TFile): Promise<void> {
const content = await this.plugin.app.vault.read(file);
const chunks: Chunk[] = chunkText(content).map(text => ({
text,
terms: termFrequencies(tokenize(text))
}));
this.entries.set(file.path, { path: file.path, mtime: file.stat.mtime, chunks });
this.recomputeStats();
}

removeFile(path: string): void {
this.entries.delete(path);
this.recomputeStats();
}

needsReindex(file: TFile): boolean {
const entry = this.entries.get(file.path);
return !entry || entry.mtime !== file.stat.mtime;
}

search(query: string): SearchResult[] {
const queryTerms = tokenize(query);
if (queryTerms.length === 0) return [];
const numDocs = this.entries.size;
const results: SearchResult[] = [];

for (const entry of this.entries.values()) {
let best = 0;
let bestChunk = '';
for (const chunk of entry.chunks) {
const chunkLen = Object.keys(chunk.terms).length || 1;
const score = bm25Score(queryTerms, chunk.terms, chunkLen, this.avgChunkLen, this.docFreq, numDocs);
if (score > best) { best = score; bestChunk = chunk.text; }
}
if (best > 0) results.push({ filePath: entry.path, snippet: bestChunk.slice(0, 300), score: best });
}
return results.sort((a, b) => b.score - a.score).slice(0, TOP_K);
}

get size(): number { return this.entries.size; }

private recomputeStats(): void {
this.docFreq = {};
let totalLen = 0;
let totalChunks = 0;
for (const entry of this.entries.values()) {
const seen = new Set<string>();
for (const chunk of entry.chunks) {
totalLen += Object.keys(chunk.terms).length;
totalChunks++;
for (const term of Object.keys(chunk.terms)) {
if (!seen.has(term)) { this.docFreq[term] = (this.docFreq[term] ?? 0) + 1; seen.add(term); }
}
}
}
this.avgChunkLen = totalChunks > 0 ? totalLen / totalChunks : 1;
}
}

// ─── Chat View ────────────────────────────────────────────────────────────────

class RAGChatView extends ItemView {
plugin: RAGChatPlugin;
messages: Message[] = [];
inputEl: HTMLTextAreaElement;
messagesContainer: HTMLElement;

constructor(leaf: WorkspaceLeaf, plugin: RAGChatPlugin) {
super(leaf);
this.plugin = plugin;
}

getViewType(): string { return VIEW_TYPE_RAG_CHAT; }
getDisplayText(): string { return 'RAG Chat'; }
getIcon(): string { return 'message-circle'; }

async onOpen(): Promise<void> {
await Promise.resolve();
const container = this.containerEl.children[1];
container.empty();
container.addClass('rag-chat-view');

this.messagesContainer = container.createDiv({ cls: 'rag-chat-messages' });
const inputContainer = container.createDiv({ cls: 'rag-chat-input-container' });
const inputWrapper = inputContainer.createDiv({ cls: 'rag-chat-input-wrapper' });

this.inputEl = inputWrapper.createEl('textarea', {
cls: 'rag-chat-input',
attr: { placeholder: 'Ask a question about your notes...', rows: '1' }
});
const sendButton = inputWrapper.createEl('button', { text: 'Send', cls: 'rag-chat-send-button' });

this.inputEl.addEventListener('input', () => {
this.inputEl.setCssProps({ '--rag-input-height': `${Math.min(this.inputEl.scrollHeight, 200)}px` });
this.inputEl.addClass('rag-chat-input--resized');
});
sendButton.addEventListener('click', () => { void this.sendMessage(); });
this.inputEl.addEventListener('keydown', (e) => {
if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void this.sendMessage(); }
});

this.renderMessages();
}

async onClose(): Promise<void> {
return Promise.resolve();
}

async sendMessage(): Promise<void> {
const question = this.inputEl.value.trim();
if (!question) return;

if (!this.plugin.settings.consentGiven) {
new Notice('Please enable data consent in settings before chatting');
return;
}
const isLocal = this.plugin.settings.provider === 'local';
const providerInfo = PROVIDERS[this.plugin.settings.provider];
if (!isLocal && providerInfo?.needsKey && !this.plugin.settings.apiKey) {
new Notice('Please configure an API key in settings');
return;
}

this.messages.push({ role: 'user', content: question });
this.renderMessages();
this.inputEl.value = '';
this.inputEl.setCssProps({ '--rag-input-height': 'auto' });
this.inputEl.removeClass('rag-chat-input--resized');

this.messages.push({ role: 'assistant', content: '...' });
this.renderMessages();

try {
const results = this.plugin.index.search(question);
const context = results.length > 0
? results.map((r, i) => `[${i + 1}] ${r.filePath}\n${r.snippet}`).join('\n\n')
: 'No relevant notes found.';

const answer = await callLLM(this.plugin.settings, [
{ role: 'system', content: `${this.plugin.settings.systemPrompt}\n\nContext from vault:\n${context}` },
{ role: 'user', content: question }
]);

this.messages.pop();
this.messages.push({ role: 'assistant', content: answer, sources: results });
this.renderMessages();
} catch (error: unknown) {
this.messages.pop();
const msg = error instanceof Error ? error.message : String(error);
this.messages.push({ role: 'assistant', content: `Error: ${msg}` });
this.renderMessages();
new Notice(`Query failed: ${msg}`);
}
}

renderMessages(): void {
this.messagesContainer.empty();

if (this.messages.length === 0) {
const empty = this.messagesContainer.createDiv({ cls: 'rag-chat-empty' });
empty.createDiv({ cls: 'rag-chat-empty-icon', text: '💬' });
empty.createDiv({ cls: 'rag-chat-empty-title', text: 'Start a conversation' });
empty.createDiv({ cls: 'rag-chat-empty-subtitle', text: 'Ask questions about your notes and get AI-powered answers with sources.' });
return;
}

for (const msg of this.messages) {
const msgDiv = this.messagesContainer.createDiv({ cls: `rag-chat-message ${msg.role}` });
msgDiv.createDiv({ cls: 'rag-chat-avatar' }).setText(msg.role === 'user' ? '��' : '🤖');
const contentWrapper = msgDiv.createDiv({ cls: 'rag-chat-content' });
const bubble = contentWrapper.createDiv({ cls: 'rag-chat-bubble' });

if (msg.content === '...') {
const loading = bubble.createDiv({ cls: 'rag-chat-loading' });
for (let i = 0; i < 3; i++) loading.createDiv({ cls: 'rag-chat-loading-dot' });
} else {
void MarkdownRenderer.renderMarkdown(msg.content, bubble, '', this.plugin);
}

if (msg.sources && msg.sources.length > 0) {
const sourcesDiv = contentWrapper.createDiv({ cls: 'rag-chat-sources' });
sourcesDiv.createDiv({ cls: 'rag-chat-source-label', text: '📚 Sources' });
for (const source of msg.sources) {
const item = sourcesDiv.createDiv({ cls: 'rag-chat-source-item' });
item.createDiv({ cls: 'rag-chat-source-file', text: source.filePath.split('/').pop() ?? source.filePath });
item.createDiv({ cls: 'rag-chat-source-snippet', text: source.snippet });
item.addEventListener('click', () => { void this.openFile(source.filePath); });
}
}
}
this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
}

async openFile(filePath: string): Promise<void> {
const file = this.app.vault.getAbstractFileByPath(filePath);
if (file instanceof TFile) {
await this.app.workspace.getLeaf(false).openFile(file);
} else {
new Notice(`File not found: ${filePath}`);
}
}
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default class RAGChatPlugin extends Plugin {
settings: RAGChatSettings;
index: VaultIndex;
private debounceTimer: ReturnType<typeof setTimeout> | null = null;

async onload(): Promise<void> {
await this.loadSettings();
this.index = new VaultIndex(this);
await this.index.load();

this.registerView(VIEW_TYPE_RAG_CHAT, (leaf) => new RAGChatView(leaf, this));
this.addRibbonIcon('message-circle', 'Open chat', () => { void this.activateView(); });

this.addCommand({ id: 'open-view', name: 'Open chat view', callback: () => { void this.activateView(); } });
this.addCommand({ id: 'rebuild-index', name: 'Rebuild vault index', callback: () => { void this.rebuildIndex(); } });

this.addSettingTab(new RAGChatSettingTab(this.app, this));

this.registerEvent(this.app.vault.on('modify', (file) => {
if (file instanceof TFile && file.extension === 'md') this.scheduleIndex(file);
}));
this.registerEvent(this.app.vault.on('create', (file) => {
if (file instanceof TFile && file.extension === 'md') this.scheduleIndex(file);
}));
this.registerEvent(this.app.vault.on('delete', (file) => {
if (file instanceof TFile && file.extension === 'md') {
this.index.removeFile(file.path);
void this.index.save();
}
}));
this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
if (file instanceof TFile && file.extension === 'md') {
this.index.removeFile(oldPath);
this.scheduleIndex(file);
}
}));

void this.initialIndex();
}

async activateView(): Promise<void> {
const { workspace } = this.app;
let leaf = workspace.getLeavesOfType(VIEW_TYPE_RAG_CHAT)[0];
if (!leaf) {
const rightLeaf = workspace.getRightLeaf(false);
if (rightLeaf) {
await rightLeaf.setViewState({ type: VIEW_TYPE_RAG_CHAT, active: true });
leaf = rightLeaf;
}
}
if (leaf) workspace.revealLeaf(leaf);
}

scheduleIndex(file: TFile): void {
if (this.debounceTimer) clearTimeout(this.debounceTimer);
this.debounceTimer = setTimeout(() => {
void (async () => {
await this.index.indexFile(file);
await this.index.save();
})();
}, 1000);
}

async initialIndex(): Promise<void> {
const toIndex = this.app.vault.getMarkdownFiles().filter(f => this.index.needsReindex(f));
if (toIndex.length === 0) return;
new Notice(`Building search index for ${toIndex.length} notes...`);
for (const file of toIndex) await this.index.indexFile(file);
await this.index.save();
new Notice(`✅ Index ready (${this.index.size} notes)`);
}

async rebuildIndex(): Promise<void> {
const mdFiles = this.app.vault.getMarkdownFiles();
new Notice(`Rebuilding index for ${mdFiles.length} notes...`);
for (const file of mdFiles) await this.index.indexFile(file);
await this.index.save();
new Notice(`✅ Index rebuilt (${mdFiles.length} notes)`);
}

async loadSettings(): Promise<void> {
const data = await this.loadData();
this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings ?? {});
}

async saveSettings(): Promise<void> {
const data = (await this.loadData()) ?? {};
await this.saveData({ ...data, settings: this.settings });
}
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

class RAGChatSettingTab extends PluginSettingTab {
plugin: RAGChatPlugin;

constructor(app: App, plugin: RAGChatPlugin) {
super(app, plugin);
this.plugin = plugin;
}

display(): void {
const { containerEl } = this;
containerEl.empty();

new Setting(containerEl).setName('Configuration').setHeading();
new Setting(containerEl).setName('AI provider').setHeading();

new Setting(containerEl)
	.setName('Provider')
	.setDesc('Select the AI provider to use')
	.addDropdown(dropdown => {
		for (const [key, info] of Object.entries(PROVIDERS)) dropdown.addOption(key, info.label);
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
	new Setting(containerEl)
		.setName('Base URL')
		.setDesc('API base URL (auto-filled for known providers)')
		.addText(text => {
			const t = text
				.setPlaceholder('https://api.openai.com')
				.setValue(this.plugin.settings.baseUrl)
				.onChange(async (value) => { this.plugin.settings.baseUrl = value.trim(); await this.plugin.saveSettings(); });
			if (!isCustom) t.setDisabled(true);
			return t;
		});

	if (isCustom || providerInfo?.needsKey) {
		new Setting(containerEl)
			.setName('API key')
			.setDesc('Your API key for the selected provider')
			.addText(text => {
				text.setPlaceholder('sk-...').setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => { this.plugin.settings.apiKey = value.trim(); await this.plugin.saveSettings(); });
				text.inputEl.type = 'password';
				return text;
			});
	}

	new Setting(containerEl)
		.setName('Model')
		.setDesc('Model name (auto-filled, change as needed)')
		.addText(text => text
			.setPlaceholder(providerInfo?.model ?? 'model-name')
			.setValue(this.plugin.settings.model)
			.onChange(async (value) => { this.plugin.settings.model = value.trim(); await this.plugin.saveSettings(); }));
}

if (isLocal) {
	new Setting(containerEl).setName('Local LLM').setHeading();

	new Setting(containerEl)
		.setName('Local LLM type')
		.setDesc('Which local server are you running?')
		.addDropdown(dropdown => {
			for (const [key, info] of Object.entries(LOCAL_LLM_TYPES)) dropdown.addOption(key, info.label);
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
	if (localInfo) new Setting(containerEl).setName('Setup hint').setDesc(`💡 ${localInfo.hint}`);

	new Setting(containerEl)
		.setName('Local server url')
		.setDesc('Full URL including port')
		.addText(text => text
			.setPlaceholder(localInfo?.defaultUrl ?? 'http://localhost:11434')
			.setValue(this.plugin.settings.localLlmUrl)
			.onChange(async (value) => { this.plugin.settings.localLlmUrl = value.trim(); await this.plugin.saveSettings(); }));

	new Setting(containerEl)
		.setName('Model name')
		.setDesc('Model to use (e.g., llama3, mistral, phi3)')
		.addText(text => text
			.setPlaceholder(localInfo?.defaultModel ?? 'llama3')
			.setValue(this.plugin.settings.localLlmModel)
			.onChange(async (value) => { this.plugin.settings.localLlmModel = value.trim(); await this.plugin.saveSettings(); }));

	new Setting(containerEl)
		.setName('Test local LLM')
		.setDesc('Check if the local server is reachable')
		.addButton(button => button.setButtonText('Test').onClick(async () => {
			button.setDisabled(true);
			const url = this.plugin.settings.localLlmUrl;
			const hint = LOCAL_LLM_TYPES[this.plugin.settings.localLlmType]?.hint ?? '';
			try {
				let reachable = false;
				for (const ep of ['/api/tags', '/v1/models', '/health']) {
					try {
						const r = await requestUrl({ url: url + ep, throw: false });
						if (r.status < 500) { reachable = true; break; }
					} catch { /* try next */ }
				}
				new Notice(reachable ? `✅ Local LLM reachable at ${url}` : `❌ Not responding at ${url}\n\n${hint}`);
			} catch {
				new Notice(`❌ Cannot reach ${url}`);
			} finally {
				button.setDisabled(false);
			}
		}));
}

new Setting(containerEl).setName('Generation').setHeading();

new Setting(containerEl)
	.setName('Temperature')
	.setDesc('Controls randomness: 0 = focused, 1 = creative')
	.addSlider(slider => slider.setLimits(0, 1, 0.1).setValue(this.plugin.settings.temperature).setDynamicTooltip()
		.onChange(async (value) => { this.plugin.settings.temperature = value; await this.plugin.saveSettings(); }));

new Setting(containerEl)
	.setName('System prompt')
	.setDesc('Instructions for the AI assistant')
	.addTextArea(text => text
		.setPlaceholder('You are a helpful assistant...')
		.setValue(this.plugin.settings.systemPrompt)
		.onChange(async (value) => { this.plugin.settings.systemPrompt = value; await this.plugin.saveSettings(); })
		.inputEl.rows = 4);

new Setting(containerEl).setName('Privacy & index').setHeading();

new Setting(containerEl)
	.setName('Data consent')
	.setDesc('I understand that my vault content may be sent to external AI APIs when using cloud providers')
	.addToggle(toggle => toggle.setValue(this.plugin.settings.consentGiven)
		.onChange(async (value) => { this.plugin.settings.consentGiven = value; await this.plugin.saveSettings(); }));

new Setting(containerEl).setName('Index status').setDesc(`${this.plugin.index.size} notes indexed`);

new Setting(containerEl)
	.setName('Rebuild index')
	.setDesc('Re-index all notes in your vault (safe to run at any time)')
	.addButton(button => button.setButtonText('Rebuild').onClick(async () => {
		button.setDisabled(true);
		button.setButtonText('Rebuilding...');
		await this.plugin.rebuildIndex();
		button.setDisabled(false);
		button.setButtonText('Rebuild');
		this.display();
	}));
}
}
