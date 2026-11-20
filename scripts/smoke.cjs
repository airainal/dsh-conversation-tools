/**
 * Offline smoke test for the conversation-tools Client half.
 *
 * It loads the shipped client.js through a stubbed ModuleLoader, then runs
 * `apply(ctx)` against a fake Cordis context and every slot registration's
 * `inject(sessionId)` resolver. React is stubbed: this harness proves the
 * module shape, dictionary parity, Remote namespace resolution, and
 * registration wiring only.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'client.js'), 'utf8');

const calls = { effects: [], dictionaries: [], registrations: [], forks: [], prompts: [], opened: [] };

function noop() {}

const React = {
	createElement: (...args) => ({ kind: 'element', args }),
	Fragment: Symbol.for('react.fragment'),
	useCallback: (fn) => fn,
	useEffect: noop,
	useLayoutEffect: noop,
	useMemo: (fn) => fn(),
	useRef: () => ({ current: null }),
	useState: (initial) => [initial, noop],
};

const ReactDOM = {
	createPortal: (element) => element,
};

const requireStub = (id) => {
	if (id === 'react') return React;
	if (id === 'react-dom') return ReactDOM;
	throw new Error(`unexpected module request: ${id}`);
};

let loaded;
global.window = {
	__ModuleLoader__: {
		load: (entry) => {
			loaded = entry.factory(requireStub);
		},
	},
};
global.document = {
	querySelector: () => null,
	createElement: () => ({ dataset: {}, textContent: '', remove: noop }),
	head: { appendChild: noop },
	addEventListener: noop,
	removeEventListener: noop,
	body: {},
};
global.navigator = {};
global.crypto = { randomUUID: () => 'request-id-1' };

// eslint-disable-next-line no-eval
eval(source);

if (loaded === undefined) throw new Error('the factory never ran');
if (typeof loaded.apply !== 'function') throw new Error('missing apply export');
if (!Array.isArray(loaded.inject)) throw new Error('missing inject export');

const sessionRemote = {
	openWorkspacePath: async (request) => ({ ok: request.path.length > 0, value: { opened: true } }),
	prompt: async (request) => {
		calls.prompts.push(request);
		return { ok: true, value: { accepted: true } };
	},
};
const commandsRemote = {
	list: async () => ({ ok: true, value: [{ name: 'compact' }, { name: 'goal' }] }),
	execute: async (_sessionId, line) => ({ ok: true, value: line === '/compact' ? { result: { kind: 'success' } } : undefined }),
};
const uiWorkspace = {
	openSession: (target) => calls.opened.push(target),
};

const services = {
	'remote.session': sessionRemote,
	'remote.commands': commandsRemote,
	uiWorkspace,
};

const ctx = {
	effect: (fn, label) => {
		calls.effects.push(label);
		const disposer = fn();
		if (typeof disposer === 'function') disposer();
		return noop;
	},
	locale: {
		register: (namespace, dicts) => {
			calls.dictionaries.push({ namespace, dicts });
			return noop;
		},
	},
	slots: {
		inject: (slotKey, callback) => {
			const disposer = callback();
			if (typeof disposer !== 'function') throw new Error(`inject("${slotKey}") returned no disposer`);
			return noop;
		},
		register: (options, component) => {
			if (typeof options.name !== 'string' || options.name === '') throw new Error('registration has no slot name');
			if (typeof options.id !== 'string' || options.id === '') throw new Error(`registration "${options.name}" has no id`);
			if (typeof component !== 'function') throw new Error(`registration "${options.id}" has no component`);
			calls.registrations.push({ options, component });
			return noop;
		},
	},
	sessions: {
		list: { getSnapshot: () => ({ byId: { 'session-1': { cwd: 'C:\\Work\\demo' } } }) },
		fork: async (options) => {
			calls.forks.push(options);
			return 'session-child';
		},
	},
	// The gateway registers namespaces as the dotted services remote.<name>, so a
	// flat name lookup is the only one that can ever resolve them.
	get: (name) => services[name],
};

loaded.apply(ctx);

const keys = Object.keys(calls.dictionaries[0].dicts.zh);
const missing = [];
for (const locale of ['zh', 'en']) {
	for (const key of keys) {
		if (typeof calls.dictionaries[0].dicts[locale][key] !== 'string') missing.push(`${locale}:${key}`);
	}
}
for (const key of Object.keys(calls.dictionaries[0].dicts.en)) {
	if (!keys.includes(key)) missing.push(`en-extra:${key}`);
}

const summary = {
	namespace: calls.dictionaries[0].namespace,
	effects: calls.effects,
	inject: loaded.inject,
	registrations: calls.registrations.map(({ options }) => `${options.name}#${options.id}@${options.order ?? 0}`),
	dictionaryKeys: keys.length,
	missingDictionaries: missing,
};

(async () => {
	for (const { options } of calls.registrations) {
		const props = options.inject('session-1');
		if (props === null || typeof props !== 'object') throw new Error(`registration "${options.id}" inject returned no props`);
		if (options.id === 'conversation-tools') {
			if (props.ops.cwd() !== 'C:\\Work\\demo') throw new Error('cwd() did not read the session row');
			const opened = await props.ops.openPath('C:\\Work\\demo\\a.txt', 'reveal');
			if (opened.ok !== true) throw new Error('openPath did not report ok');
			const failed = await props.ops.openPath('', 'reveal');
			if (failed.ok !== false) throw new Error('openPath accepted an empty path');

			// Editing a known message forks before it and admits the text there.
			const edited = await props.ops.submitEdit({ seq: 41, text: 'edited text' });
			if (edited.ok !== true) throw new Error('submitEdit did not report ok');
			if (calls.forks.length !== 1 || calls.forks[0].atSeq !== 40) throw new Error(`unexpected fork boundary ${JSON.stringify(calls.forks)}`);
			if (calls.prompts.at(-1)?.sessionId !== 'session-child') throw new Error('submitEdit did not prompt the fork');
			if (calls.prompts.at(-1)?.content?.[0]?.text !== 'edited text') throw new Error('submitEdit did not carry the edited text');
			if (calls.opened.at(-1) !== 'session-child') throw new Error('submitEdit did not open the fork');

			// An unknown boundary still sends, in the current session.
			calls.forks.length = 0;
			const unsynced = await props.ops.submitEdit({ seq: undefined, text: 'again' });
			if (unsynced.ok !== true) throw new Error('submitEdit without a seq failed');
			if (calls.forks.length !== 0) throw new Error('submitEdit forked without a boundary');
			if (calls.prompts.at(-1)?.sessionId !== 'session-1') throw new Error('submitEdit without a seq targeted the wrong session');
		}
		if (options.id === 'context-compact') {
			const available = await props.ops.available();
			if (available !== true) throw new Error('compact command was not detected');
			const compacted = await props.ops.compact();
			if (compacted.ok !== true) throw new Error('compact() did not report ok');
		}
	}
	console.log(JSON.stringify(summary, null, 2));
	console.log('smoke test: ok');
})().catch((error) => {
	console.error('smoke test failed:', error);
	process.exitCode = 1;
});
