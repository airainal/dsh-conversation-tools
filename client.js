/**
 * Conversation tools, browser half.
 *
 * Three additive surfaces on top of the shipped conversation UI:
 *
 * 1. A context menu for the blue file links the Markdown renderer produces.
 *    The menu reveals the path in the file manager or opens it in the default
 *    application through `session.openWorkspacePath`, so the Host keeps
 *    verifying every path before a native process starts.
 * 2. In-place editing of a sent user message, the way a chat client edits an
 *    earlier turn: the bubble itself becomes a textarea, and sending forks the
 *    Session at the boundary before that message, admits the edited text into
 *    the fork, and opens it.
 * 3. A manual compaction pill in `conversation.composer.dock`, immediately left
 *    of the context-occupancy ring, that runs the Session's existing
 *    `/compact` command.
 *
 * Remote namespaces are separate Cordis services named `remote.<namespace>`;
 * `ctx.get('remote')` returns only the parent facade, so every call resolves
 * `ctx.get('remote.session')` or `ctx.get('remote.commands')` directly.
 *
 * @module @local/dsh-conversation-tools/client
 */

window.__ModuleLoader__.load({
	id: '@local/dsh-conversation-tools',
	factory(require) {
		const React = require('react');
		const ReactDOM = require('react-dom');

		const h = React.createElement;
		const { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } = React;

		/** Dictionary namespace owned by this plugin. */
		const NS = 'conversationTools';

		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			'file.menu': '文件操作',
			'file.reveal': '在文件管理器中打开',
			'file.open': '用默认应用打开',
			'file.failed': '无法打开该位置',
			'file.unavailable': '当前环境不支持打开本地文件',
			'edit.action': '编辑',
			'edit.title': '编辑这条消息',
			'edit.hint': 'Ctrl+Enter 发送 · Esc 取消',
			'edit.cancel': '取消',
			'edit.send': '发送',
			'edit.saving': '发送中',
			'edit.failed': '发送失败，请稍后再试',
			'edit.unavailable': '当前会话无法发送消息',
			'edit.appended': '无法创建分支，已作为新消息发送',
			'compact.action': '压缩',
			'compact.busy': '压缩中',
			'compact.title': '立即压缩会话上下文（/compact）',
			'compact.high': '上下文已用 {percent}%，点击压缩',
			'compact.failed': '压缩失败，请稍后再试',
			'compact.unavailable': '当前会话不支持手动压缩',
		};

		/** English dictionary, checked complete against the zh key set. */
		const en = {
			'file.menu': 'File actions',
			'file.reveal': 'Open in file manager',
			'file.open': 'Open in default app',
			'file.failed': 'Could not open this location',
			'file.unavailable': 'This environment cannot open local files',
			'edit.action': 'Edit',
			'edit.title': 'Edit this message',
			'edit.hint': 'Ctrl+Enter to send · Esc to cancel',
			'edit.cancel': 'Cancel',
			'edit.send': 'Send',
			'edit.saving': 'Sending',
			'edit.failed': 'Could not send; try again shortly',
			'edit.unavailable': 'This session cannot send messages',
			'edit.appended': 'Could not branch; sent as a new message',
			'compact.action': 'Compact',
			'compact.busy': 'Compacting',
			'compact.title': 'Compact the session context now (/compact)',
			'compact.high': 'Context {percent}% used; click to compact',
			'compact.failed': 'Compaction failed; try again shortly',
			'compact.unavailable': 'This session cannot compact manually',
		};

		/** Plugin stylesheet, inserted once per Client run and removed with it. */
		const CSS = `
.dct-edit{position:fixed;z-index:1300;box-sizing:border-box;display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 8px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-specific-menu,var(--dsw-alias-bg-overlay));color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:16px;white-space:nowrap;cursor:pointer;box-shadow:var(--dsw-elevation-soft,0 1px 4px rgb(0 0 0 / 12%))}
.dct-edit:hover,.dct-edit:focus-visible{background:var(--dsw-alias-interactive-bg-hover,rgb(0 0 0 / 6%));color:var(--dsw-alias-label-primary);outline:none}
.dct-edit svg{flex:none;width:13px;height:13px}
.dct-menu{position:fixed;z-index:1310;box-sizing:border-box;display:flex;flex-direction:column;gap:2px;min-width:190px;max-width:340px;padding:6px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg,10px);background:var(--dsw-specific-menu,var(--dsw-alias-bg-overlay));box-shadow:var(--dsw-elevation-prominent,0 8px 24px rgb(0 0 0 / 18%));backdrop-filter:var(--dsw-menu-backdrop-filter,blur(12px));color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:18px}
.dct-menu-path{margin:0 0 4px;padding:4px 8px 6px;border-bottom:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dct-item{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;margin:0;padding:6px 8px;border:none;border-radius:var(--dsw-radius-sm,6px);background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;text-align:left;cursor:pointer}
.dct-item:hover,.dct-item:focus-visible{background:var(--dsw-alias-interactive-bg-hover,rgb(0 0 0 / 6%));outline:none}
.dct-item svg{flex:none;width:14px;height:14px;color:var(--dsw-alias-label-secondary)}
.dct-menu-error{padding:4px 8px;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:16px}
@keyframes dct-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.dct-editor{position:fixed;z-index:1320;box-sizing:border-box;display:flex;flex-direction:column;gap:6px;padding:12px 14px 10px;border:none;border-radius:18px;background:var(--dsw-alias-bg-base,#fff);box-shadow:-7px -7px 18px rgb(255 255 255 / 92%),10px 12px 26px rgb(23 28 38 / 15%),0 2px 5px rgb(23 28 38 / 5%),inset 0 1px 0 rgb(255 255 255 / 85%);font:inherit;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary);transition:box-shadow .18s ease,transform .18s ease}
.dct-editor[data-ready]{animation:dct-rise .18s ease-out}
.dct-editor:focus-within{transform:translateY(-1px);box-shadow:-9px -9px 22px rgb(255 255 255 / 95%),13px 16px 34px rgb(23 28 38 / 18%),0 3px 8px rgb(23 28 38 / 6%),inset 0 1px 0 rgb(255 255 255 / 90%)}
body[data-ds-dark-theme] .dct-editor{background:var(--dsw-alias-bg-base,#191b1f);box-shadow:-6px -6px 16px rgb(255 255 255 / 5%),10px 12px 26px rgb(0 0 0 / 55%),0 2px 6px rgb(0 0 0 / 40%),inset 0 1px 0 rgb(255 255 255 / 6%)}
body[data-ds-dark-theme] .dct-editor:focus-within{box-shadow:-8px -8px 20px rgb(255 255 255 / 7%),13px 16px 34px rgb(0 0 0 / 62%),0 3px 9px rgb(0 0 0 / 45%),inset 0 1px 0 rgb(255 255 255 / 8%)}
.dct-editor-input{box-sizing:border-box;width:100%;min-height:22px;max-height:46vh;margin:0;padding:1px 2px;border:none;outline:none;background:0 0;color:inherit;font:inherit;line-height:inherit;resize:none;overflow-y:auto}
.dct-editor-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:16px;overflow-wrap:anywhere}
.dct-editor-bar{display:flex;align-items:center;gap:8px;justify-content:flex-end;padding-top:2px}
.dct-editor-hint{flex:1 1 auto;min-width:0;margin-right:auto;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary));font-size:12px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dct-btn{box-sizing:border-box;flex:none;height:26px;margin:0;padding:0 13px;border:none;border-radius:999px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:16px;white-space:nowrap;cursor:pointer;box-shadow:-2px -2px 5px rgb(255 255 255 / 90%),2px 3px 7px rgb(23 28 38 / 12%);transition:box-shadow .15s ease,transform .15s ease,color .15s ease}
.dct-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary);transform:translateY(-1px);box-shadow:-3px -3px 7px rgb(255 255 255 / 95%),3px 5px 11px rgb(23 28 38 / 16%)}
.dct-btn:active:not(:disabled){transform:translateY(0);box-shadow:inset 1px 1px 3px rgb(23 28 38 / 14%),inset -1px -1px 3px rgb(255 255 255 / 85%)}
.dct-btn:disabled{cursor:default;opacity:.5;box-shadow:none}
body[data-ds-dark-theme] .dct-btn{background:var(--dsw-alias-bg-base,#191b1f);box-shadow:-2px -2px 5px rgb(255 255 255 / 5%),2px 3px 7px rgb(0 0 0 / 50%)}
body[data-ds-dark-theme] .dct-btn:hover:not(:disabled){box-shadow:-3px -3px 7px rgb(255 255 255 / 7%),3px 5px 11px rgb(0 0 0 / 58%)}
.dct-btn-primary,.dct-btn-primary:hover:not(:disabled),.dct-btn-primary:active:not(:disabled){background:var(--dsw-alias-button-info-fill,var(--dsw-alias-brand-primary));color:#fff}
.dct-btn-primary{box-shadow:0 7px 16px -7px color-mix(in srgb,var(--dsw-alias-button-info-fill,#4d6bfe) 75%,transparent),0 1px 2px rgb(23 28 38 / 12%)}
.dct-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-info-hover,var(--dsw-alias-button-info-fill));transform:translateY(-1px);box-shadow:0 10px 20px -8px color-mix(in srgb,var(--dsw-alias-button-info-fill,#4d6bfe) 85%,transparent),0 2px 4px rgb(23 28 38 / 14%)}
.dct-btn-primary:active:not(:disabled){transform:translateY(0);box-shadow:0 3px 8px -4px color-mix(in srgb,var(--dsw-alias-button-info-fill,#4d6bfe) 80%,transparent)}
body[data-ds-dark-theme] .dct-btn-primary,body[data-ds-dark-theme] .dct-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-info-fill,var(--dsw-alias-brand-primary));color:#fff;box-shadow:0 8px 18px -8px rgb(0 0 0 / 70%)}
.dct-compact-root{position:relative;display:inline-flex;align-items:center;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px))}
.dct-compact{display:inline-flex;align-items:center;gap:5px;box-sizing:border-box;margin:0;padding:1px 8px;border:none;border-radius:var(--dsw-radius-sm,6px);background:0 0;color:var(--dsw-alias-label-tertiary);font:inherit;line-height:inherit;white-space:nowrap;cursor:pointer;transition:background-color .12s,color .12s}
.dct-compact:hover:not(:disabled),.dct-compact:focus-visible{background:var(--dsw-alias-interactive-bg-hover,rgb(0 0 0 / 6%));color:var(--dsw-alias-label-secondary);outline:none}
.dct-compact:disabled{cursor:default;opacity:.45}
.dct-compact svg{flex:none;width:14px;height:14px}
.dct-compact[data-high]{color:var(--dsw-alias-state-warn-primary)}
.dct-compact-error{position:absolute;right:0;bottom:calc(100% + 6px);z-index:10;padding:4px 8px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-specific-menu,var(--dsw-alias-bg-overlay));box-shadow:var(--dsw-elevation-soft,0 1px 4px rgb(0 0 0 / 12%));color:var(--dsw-alias-state-error-primary);font:inherit;font-size:12px;line-height:16px;white-space:nowrap}
.dct-toast{position:fixed;left:50%;bottom:96px;z-index:1330;transform:translateX(-50%);padding:6px 12px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-specific-menu,var(--dsw-alias-bg-overlay));box-shadow:var(--dsw-elevation-soft,0 1px 4px rgb(0 0 0 / 12%));color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;pointer-events:none}
`;

		/**
		 * Insert the plugin stylesheet once, returning the disposer that removes it.
		 * @returns cleanup for the inserted style element.
		 */
		function installStyles() {
			const marker = '@local/dsh-conversation-tools/styles';
			const existing = document.querySelector(`style[data-plugin-css='${marker}']`);
			if (existing !== null) return () => {};
			const tag = document.createElement('style');
			tag.dataset.plugin = '@local/dsh-conversation-tools';
			tag.dataset.pluginCss = marker;
			tag.textContent = CSS;
			document.head.appendChild(tag);
			return () => {
				tag.remove();
			};
		}

		/**
		 * Resolve one Client Remote namespace.
		 *
		 * Namespaces are registered as the dotted services `remote.session` and
		 * `remote.commands`, so the parent `remote` service never carries them as
		 * properties; only the exact service name resolves.
		 * @param ctx - the Client root context.
		 * @param name - namespace name such as `session` or `commands`.
		 * @returns the namespace service, or undefined before it is mounted.
		 */
		function remoteNamespace(ctx, name) {
			try {
				return ctx.get(`remote.${name}`);
			} catch (_error) {
				return undefined;
			}
		}

		//#region path syntax
		/** Windows drive or UNC prefix. */
		const WINDOWS_PATH = /^(?:[a-zA-Z]:[\\/]|\\\\)/u;
		/** Any URI scheme prefix, which is never a local path here. */
		const URI_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]+:/u;

		/**
		 * Report whether a value is already an absolute path.
		 * @param value - authored path text.
		 * @returns true for `C:\`, `\\server`, or `/` roots.
		 */
		function isAbsolutePath(value) {
			return WINDOWS_PATH.test(value) || value.startsWith('/');
		}

		/**
		 * Pick the separator a path family uses.
		 * @param value - any path or directory in the same family.
		 * @returns the backslash for Windows paths, otherwise the forward slash.
		 */
		function separatorFor(value) {
			return WINDOWS_PATH.test(value) || value.includes('\\') ? '\\' : '/';
		}

		/**
		 * Collapse `.` and `..` segments and normalize separators.
		 * @param value - a path that may mix separators or carry relative segments.
		 * @returns the shortest equivalent spelling in the path family's separator.
		 */
		function normalizePath(value) {
			const sep = separatorFor(value);
			let rest = value.replace(/\\/gu, '/');
			const drive = /^[a-zA-Z]:/u.exec(rest)?.[0] ?? '';
			if (drive !== '') rest = rest.slice(drive.length);
			const absolute = rest.startsWith('/');
			const stack = [];
			for (const part of rest.split('/')) {
				if (part === '' || part === '.') continue;
				if (part === '..') {
					stack.pop();
					continue;
				}
				stack.push(part);
			}
			const body = stack.join(sep);
			if (drive !== '') return drive + sep + body;
			return (absolute ? sep : '') + body;
		}

		/**
		 * Join one authored path onto a directory.
		 * @param cwd - absolute working directory.
		 * @param value - relative authored path.
		 * @returns the normalized absolute path.
		 */
		function joinPath(cwd, value) {
			const sep = separatorFor(cwd);
			const base = cwd.endsWith('/') || cwd.endsWith('\\') ? cwd.slice(0, -1) : cwd;
			return normalizePath(base + sep + value);
		}

		/**
		 * Resolve one authored link target against the Session working directory.
		 * @param raw - the path spelling a rendered link carries.
		 * @param cwd - the Session working directory, when known.
		 * @returns an absolute local path, or null when the target is not local.
		 */
		function resolveAuthoredPath(raw, cwd) {
			let value = String(raw ?? '').trim();
			if (value === '') return null;
			if (value.startsWith('file://')) {
				const rest = value.slice('file://'.length);
				try {
					value = decodeURIComponent(rest);
				} catch (_error) {
					value = rest;
				}
				value = value.replace(/^\/([a-zA-Z]:)/u, '$1');
			}
			value = value.replace(/^[`"'“”]+|[`"'“”]+$/gu, '').trim();
			if (value === '') return null;
			if (isAbsolutePath(value)) return normalizePath(value);
			if (URI_SCHEME.test(value)) return null;
			if (cwd === undefined || cwd === '') return null;
			return joinPath(cwd, value);
		}

		/**
		 * Recognize the authored text of a bare file name, as opposed to prose.
		 * @param value - candidate inline text.
		 * @returns true when the text carries a separator or a file extension.
		 */
		function looksLikePath(value) {
			return /[\\/]/u.test(value) || /\.[A-Za-z0-9]{1,8}$/u.test(value);
		}

		/**
		 * Read the local target a rendered Markdown file link points at.
		 * @param link - the file-link button element.
		 * @param cwd - the Session working directory, when known.
		 * @returns the absolute path, or null when this link has no local target.
		 */
		function filePathFor(link, cwd) {
			const title = (link.getAttribute('title') ?? '').trim();
			const text = (link.textContent ?? '').trim();
			const candidate = title !== '' ? title : text;
			if (candidate === '') return null;
			if (title === '' && !looksLikePath(candidate)) return null;
			return resolveAuthoredPath(candidate, cwd);
		}
		//#endregion

		//#region DOM helpers
		/**
		 * Read the authored text of one rendered user message.
		 * @param row - the chat flow row carrying `data-chat-flow-kind="user"`.
		 * @returns the message text without chrome, attachments, or time.
		 */
		function readUserText(row) {
			const clone = row.cloneNode(true);
			for (const element of clone.querySelectorAll('[data-clock], [data-message-attachments], [class*="referenceSummary"], [data-slot-error]')) element.remove();
			return (clone.textContent ?? '').replace(/\u00a0/gu, ' ').trim();
		}

		//#region editable rows
		/**
		 * Chat flow kinds that render one user-authored bubble.
		 *
		 * DSH classifies a message typed while the previous turn is still running as
		 * `steering`: it renders with the same bubble and action row but a different
		 * `data-chat-flow-kind`, so keying only on `user` silently hides the control
		 * in every session whose messages arrived mid-turn.
		 */
		const EDITABLE_FLOW_KINDS = ['user', 'steering'];
		/** One `closest()` selector covering every user-authored flow row. */
		const EDITABLE_ROW_SELECTOR = EDITABLE_FLOW_KINDS.map((kind) => `[data-chat-flow-kind="${kind}"]`).join(', ');

		/**
		 * Test whether one flow kind is a user-authored message.
		 * @param kind - the `data-chat-flow-kind` value of a chat flow row.
		 * @returns whether the row carries a sent message.
		 */
		function isEditableFlowKind(kind) {
			return EDITABLE_FLOW_KINDS.includes(kind);
		}
		//#endregion

		/**
		 * Measure the bubble one row draws, which is the area an in-place editor covers.
		 * @param row - the chat flow row of a sent message.
		 * @returns the bubble rectangle, or null when the row is gone.
		 */
		function bubbleRect(row) {
			if (!row.isConnected) return null;
			const bubble = row.querySelector('[class*="bubble"]') ?? row;
			const rect = bubble.getBoundingClientRect();
			return rect.width < 2 || rect.height < 2 ? null : rect;
		}

		/**
		 * Read one Session's effective working directory.
		 * @param ctx - the Client root context.
		 * @param sessionId - Session whose list row carries the directory.
		 * @returns the directory when the list already published it.
		 */
		function currentCwd(ctx, sessionId) {
			try {
				const list = ctx.sessions?.list?.getSnapshot?.();
				const cwd = list?.byId?.[sessionId]?.cwd;
				if (typeof cwd === 'string' && cwd !== '') return cwd;
			} catch (_error) {
				/* a missing list row only costs relative-link resolution */
			}
			return undefined;
		}

		/**
		 * Mint one client request identity for an admitted prompt.
		 * @returns a unique request id.
		 */
		function newRequestId() {
			try {
				if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
			} catch (_error) {
				/* fall through to the timestamp form */
			}
			return `edited-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
		}
		//#endregion

		//#region icons
		/**
		 * File-manager reveal glyph.
		 * @returns the folder outline.
		 */
		function IconFolder() {
			return h('svg', { viewBox: '0 0 16 16', 'aria-hidden': true },
				h('path', {
					d: 'M1.75 4.25c0-.83.67-1.5 1.5-1.5h3.02c.4 0 .78.16 1.06.44l.73.73h4.69c.83 0 1.5.67 1.5 1.5v6.33c0 .83-.67 1.5-1.5 1.5h-9.5c-.83 0-1.5-.67-1.5-1.5z',
					fill: 'none',
					stroke: 'currentColor',
					strokeWidth: '1.3',
					strokeLinejoin: 'round',
				}));
		}

		/**
		 * Default-application glyph.
		 * @returns the launch arrow.
		 */
		function IconLaunch() {
			return h('svg', { viewBox: '0 0 16 16', 'aria-hidden': true },
				h('path', {
					d: 'M9.5 2.25h4.25V6.5M13.4 2.6 7.6 8.4M11.25 9.25v3.5c0 .83-.67 1.5-1.5 1.5h-6c-.83 0-1.5-.67-1.5-1.5v-6c0-.83.67-1.5 1.5-1.5h3.5',
					fill: 'none',
					stroke: 'currentColor',
					strokeWidth: '1.3',
					strokeLinecap: 'round',
					strokeLinejoin: 'round',
				}));
		}

		/**
		 * Edit pencil glyph.
		 * @returns the pencil outline.
		 */
		function IconEdit() {
			return h('svg', { viewBox: '0 0 16 16', 'aria-hidden': true },
				h('path', {
					d: 'M10.4 2.6a1.55 1.55 0 0 1 2.19 0l.81.81a1.55 1.55 0 0 1 0 2.19l-6.6 6.6-2.9.72.72-2.9zM9.15 3.85l3 3',
					fill: 'none',
					stroke: 'currentColor',
					strokeWidth: '1.3',
					strokeLinecap: 'round',
					strokeLinejoin: 'round',
				}));
		}

		/**
		 * Compress-into-the-middle glyph for the compaction pill.
		 * @returns the inward arrows.
		 */
		function IconCompress() {
			return h('svg', { viewBox: '0 0 16 16', 'aria-hidden': true },
				h('path', {
					d: 'M3.5 2.5 8 6.5l4.5-4M3.5 13.5 8 9.5l4.5 4M8 6.5v3',
					fill: 'none',
					stroke: 'currentColor',
					strokeWidth: '1.3',
					strokeLinecap: 'round',
					strokeLinejoin: 'round',
				}));
		}
		//#endregion

		//#region file context menu
		/**
		 * Floating file menu anchored at the pointer, with edge clamping and
		 * dismissal on outside press, Escape, scroll, or window blur.
		 * @param props - menu target, translator, and the chosen action callback.
		 * @returns the portaled menu element.
		 */
		function FileMenu({ menu, t, onChoose, onDismiss, failure }) {
			const ref = useRef(null);
			const [position, setPosition] = useState(null);

			useLayoutEffect(() => {
				const node = ref.current;
				if (node === null) return;
				const rect = node.getBoundingClientRect();
				const margin = 8;
				const left = Math.min(Math.max(margin, menu.x), Math.max(margin, window.innerWidth - rect.width - margin));
				const top = menu.y + rect.height + margin > window.innerHeight ? Math.max(margin, menu.y - rect.height) : menu.y;
				setPosition({ left, top });
				const first = node.querySelector('button');
				if (first instanceof HTMLElement) first.focus({ preventScroll: true });
			}, [menu]);

			useEffect(() => {
				const onPointerDown = (event) => {
					const node = ref.current;
					if (node !== null && event.target instanceof Node && node.contains(event.target)) return;
					onDismiss();
				};
				const onKeyDown = (event) => {
					if (event.key !== 'Escape') return;
					event.preventDefault();
					onDismiss();
				};
				document.addEventListener('pointerdown', onPointerDown, true);
				document.addEventListener('keydown', onKeyDown, true);
				document.addEventListener('scroll', onDismiss, true);
				window.addEventListener('blur', onDismiss);
				return () => {
					document.removeEventListener('pointerdown', onPointerDown, true);
					document.removeEventListener('keydown', onKeyDown, true);
					document.removeEventListener('scroll', onDismiss, true);
					window.removeEventListener('blur', onDismiss);
				};
			}, [onDismiss]);

			const style = position === null ? { left: menu.x, top: menu.y, visibility: 'hidden' } : position;
			return h('div', {
				ref,
				className: 'dct-menu',
				role: 'menu',
				'aria-label': t('file.menu'),
				style,
				onContextMenu: (event) => {
					event.preventDefault();
					event.stopPropagation();
				},
			},
			h('div', { key: 'path', className: 'dct-menu-path', title: menu.path }, menu.path),
			h('button', {
				key: 'reveal',
				type: 'button',
				role: 'menuitem',
				className: 'dct-item',
				onClick: () => onChoose('reveal'),
			}, h(IconFolder, { key: 'icon' }), h('span', { key: 'label' }, t('file.reveal'))),
			h('button', {
				key: 'open',
				type: 'button',
				role: 'menuitem',
				className: 'dct-item',
				onClick: () => onChoose('open'),
			}, h(IconLaunch, { key: 'icon' }), h('span', { key: 'label' }, t('file.open'))),
			failure === null ? null : h('div', { key: 'failure', className: 'dct-menu-error', role: 'alert' }, failure));
		}
		//#endregion

		//#region overlay entry
		/**
		 * Invisible entry that renders three portaled surfaces over the transcript:
		 * the file-link context menu, the hover edit control, and the in-place
		 * message editor.
		 * @param props - the Session's verbs, the chat snapshot seat, and the locale seat.
		 * @returns nothing inside the composer card; every surface is portaled.
		 */
		function ConversationToolsOverlay({ t, ops, useChat }) {
			const [menu, setMenu] = useState(null);
			const [menuFailure, setMenuFailure] = useState(null);
			const [hoverRow, setHoverRow] = useState(null);
			const [editPosition, setEditPosition] = useState(null);
			const [editing, setEditing] = useState(null);
			const [draft, setDraft] = useState('');
			const [busy, setBusy] = useState(false);
			const [editError, setEditError] = useState(null);
			const [editorRect, setEditorRect] = useState(null);
			const [toast, setToast] = useState(null);
			const editRef = useRef(null);
			const inputRef = useRef(null);
			const hoverRowRef = useRef(null);
			const hideTimerRef = useRef(null);
			const chatRef = useRef(undefined);

			// Keep the newest Chat snapshot reachable from event handlers without
			// subscribing this entry to every chat revision.
			if (typeof useChat === 'function') {
				useChat((snapshot) => {
					chatRef.current = snapshot;
					return undefined;
				});
			}

			useEffect(() => {
				if (toast === null) return;
				const timer = window.setTimeout(() => setToast(null), 3600);
				return () => window.clearTimeout(timer);
			}, [toast]);

			const clearHideTimer = useCallback(() => {
				if (hideTimerRef.current === null) return;
				window.clearTimeout(hideTimerRef.current);
				hideTimerRef.current = null;
			}, []);

			const clearHover = useCallback(() => {
				clearHideTimer();
				hoverRowRef.current = null;
				setHoverRow(null);
				setEditPosition(null);
			}, [clearHideTimer]);

			// Blue file links: take over the browser context menu and offer a native reveal.
			useEffect(() => {
				const onContextMenu = (event) => {
					if (event.defaultPrevented) return;
					const target = event.target;
					if (!(target instanceof Element)) return;
					let link = target.closest('button[class*="fileMention"]') ?? target.closest('[class*="markdown"] code > button');
					if (link === null) {
						const code = target.closest('[class*="markdown"] code');
						if (code === null) return;
						link = code.querySelector('button[class*="fileMention"]') ?? code.querySelector('button');
						if (link === null) return;
					}
					const path = filePathFor(link, ops.cwd());
					if (path === null) return;
					event.preventDefault();
					event.stopPropagation();
					clearHover();
					setMenuFailure(null);
					setMenu({ x: event.clientX, y: event.clientY, path });
				};
				document.addEventListener('contextmenu', onContextMenu, true);
				return () => document.removeEventListener('contextmenu', onContextMenu, true);
			}, [clearHover, ops]);

			// Sent messages: keep the edit control attached to the hovered row.
			useEffect(() => {
				const hide = () => {
					if (editing !== null) return;
					clearHover();
				};
				const onPointerOver = (event) => {
					if (editing !== null) {
						// A transcript re-render can drop the row the editor was opened on;
						// that leaves an invisible editor which would swallow every later
						// hover, so release it instead of dead-locking the whole session.
						if (!editing.row.isConnected) {
							setEditing(null);
							setDraft('');
							setEditError(null);
							setBusy(false);
						}
						return;
					}
					const target = event.target;
					if (!(target instanceof Element)) return;
					const button = editRef.current;
					if (button !== null && button.contains(target)) {
						clearHideTimer();
						return;
					}
					const current = hoverRowRef.current;
					if (current !== null && !current.isConnected) clearHover();
					const row = target.closest(EDITABLE_ROW_SELECTOR);
					if (row !== null) {
						if (row === hoverRowRef.current) return;
						if (row.querySelector('[data-clock], [data-submission-echo], [class*="bubble"]') === null) return;
						if (readUserText(row) === '') return;
						clearHideTimer();
						hoverRowRef.current = row;
						setHoverRow(row);
						return;
					}
					if (hoverRowRef.current === null) return;
					clearHideTimer();
					hideTimerRef.current = window.setTimeout(hide, 220);
				};
				document.addEventListener('pointerover', onPointerOver, true);
				document.addEventListener('scroll', hide, true);
				window.addEventListener('blur', hide);
				return () => {
					document.removeEventListener('pointerover', onPointerOver, true);
					document.removeEventListener('scroll', hide, true);
					window.removeEventListener('blur', hide);
					clearHideTimer();
				};
			}, [clearHideTimer, clearHover, editing]);

			useLayoutEffect(() => {
				if (hoverRow === null) {
					setEditPosition(null);
					return;
				}
				const button = editRef.current;
				if (button === null) return;
				const size = button.getBoundingClientRect();
				const anchor = hoverRow.querySelector('[data-clock]');
				const anchorRect = anchor === null ? null : anchor.getBoundingClientRect();
				const rowRect = hoverRow.getBoundingClientRect();
				let left;
				let top;
				if (anchorRect !== null && anchorRect.width > 0 && anchorRect.height > 0) {
					left = anchorRect.left - size.width - 6;
					top = anchorRect.top + (anchorRect.height - size.height) / 2;
				} else {
					left = rowRect.right - size.width - 8;
					top = rowRect.bottom - size.height - 4;
				}
				setEditPosition({ left: Math.max(8, left), top: Math.max(8, top) });
			}, [hoverRow]);

			// Keep the in-place editor over its bubble while the transcript scrolls.
			useLayoutEffect(() => {
				if (editing === null) {
					setEditorRect(null);
					return;
				}
				const measure = () => {
					const rect = bubbleRect(editing.row);
					if (rect === null) {
						// The row was pruned or replaced: close the editor rather than leave an
						// unpositioned panel that keeps the hover handler disabled.
						if (!editing.row.isConnected) {
							setEditing(null);
							setDraft('');
							setEditError(null);
							setBusy(false);
							setEditorRect(null);
						}
						return;
					}
					// A one-character bubble is only a few dozen pixels wide; the editor keeps the
					// bubble's right edge but grows leftwards to a usable writing width.
					const gutter = 12;
					const width = Math.max(340, Math.min(rect.width, window.innerWidth - gutter * 2));
					const right = Math.min(rect.right, window.innerWidth - gutter);
					setEditorRect({ left: Math.max(gutter, right - width), top: rect.top, width, minHeight: rect.height });
				};
				measure();
				let frame = 0;
				const schedule = () => {
					if (frame !== 0) return;
					frame = window.requestAnimationFrame(() => {
						frame = 0;
						measure();
					});
				};
				document.addEventListener('scroll', schedule, true);
				window.addEventListener('resize', schedule);
				return () => {
					if (frame !== 0) window.cancelAnimationFrame(frame);
					document.removeEventListener('scroll', schedule, true);
					window.removeEventListener('resize', schedule);
				};
			}, [editing]);

			// Grow the textarea to its content.
			useLayoutEffect(() => {
				if (editing === null) return;
				const node = inputRef.current;
				if (node === null) return;
				node.style.height = 'auto';
				node.style.height = `${node.scrollHeight}px`;
			}, [editing, draft]);

			const startEdit = useCallback(() => {
				const row = hoverRowRef.current;
				if (row === null) return;
				const text = readUserText(row);
				const nodeKey = row.getAttribute('data-chat-node-key');
				clearHover();
				if (text === '') return;
				setEditError(null);
				setBusy(false);
				setDraft(text);
				setEditing({ row, nodeKey, text });
			}, [clearHover]);

			const cancelEdit = useCallback(() => {
				setEditing(null);
				setDraft('');
				setEditError(null);
				setBusy(false);
			}, []);

			const submitEdit = useCallback(async () => {
				if (editing === null || busy) return;
				const text = draft.trim();
				if (text === '') return;
				if (text === editing.text.trim()) {
					cancelEdit();
					return;
				}
				setBusy(true);
				setEditError(null);
				const node = editing.nodeKey === null ? undefined : chatRef.current?.nodes?.get(editing.nodeKey);
				const seq = typeof node?.data?.seq === 'number' ? node.data.seq : undefined;
				const result = await ops.submitEdit({ seq, text });
				setBusy(false);
				if (result.ok) {
					setEditing(null);
					setDraft('');
					if (result.forked === false) setToast(t('edit.appended'));
					return;
				}
				setEditError(t(`edit.${result.code ?? 'failed'}`));
			}, [busy, cancelEdit, draft, editing, ops, t]);

			const onChoose = useCallback(async (action) => {
				const path = menu?.path;
				if (path === undefined) return;
				setMenuFailure(null);
				const result = await ops.openPath(path, action);
				if (result.ok) {
					setMenu(null);
					return;
				}
				const reason = t(result.code === 'unavailable' ? 'file.unavailable' : 'file.failed');
				setMenuFailure(result.detail === undefined ? reason : `${reason} (${result.detail})`);
			}, [menu, ops, t]);

			const dismissMenu = useCallback(() => setMenu(null), []);

			const editStyle = editPosition === null
				? { left: 0, top: 0, visibility: 'hidden' }
				: { left: editPosition.left, top: editPosition.top };

			const editorStyle = editorRect === null
				? { left: 0, top: 0, visibility: 'hidden' }
				: editorRect;

			return h(Fragment, null,
				menu === null ? null : ReactDOM.createPortal(
					h(FileMenu, { menu, t, onChoose, onDismiss: dismissMenu, failure: menuFailure }),
					document.body,
				),
				toast === null ? null : ReactDOM.createPortal(
					h('div', { className: 'dct-toast', role: 'status' }, toast),
					document.body,
				),
				hoverRow === null || editing !== null ? null : ReactDOM.createPortal(
					h('button', {
						ref: editRef,
						type: 'button',
						className: 'dct-edit',
						style: editStyle,
						title: t('edit.title'),
						'aria-label': t('edit.title'),
						onPointerDown: (event) => event.preventDefault(),
						onClick: startEdit,
					}, h(IconEdit, { key: 'icon' }), h('span', { key: 'label' }, t('edit.action'))),
					document.body,
				),
				editing === null ? null : ReactDOM.createPortal(
					h('div', { className: 'dct-editor', 'data-ready': editorRect === null ? undefined : true, style: editorStyle },
						h('textarea', {
							ref: inputRef,
							className: 'dct-editor-input',
							value: draft,
							spellCheck: false,
							autoFocus: true,
							'aria-label': t('edit.title'),
							onChange: (event) => setDraft(event.target.value),
							onKeyDown: (event) => {
								if (event.key === 'Escape') {
									event.preventDefault();
									cancelEdit();
									return;
								}
								if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
									event.preventDefault();
									submitEdit();
								}
							},
						}),
						editError === null ? null : h('div', { className: 'dct-editor-error', role: 'alert' }, editError),
						h('div', { className: 'dct-editor-bar' },
							h('span', { className: 'dct-editor-hint' }, t('edit.hint')),
							h('button', {
								type: 'button',
								className: 'dct-btn',
								disabled: busy,
								onClick: cancelEdit,
							}, t('edit.cancel')),
							h('button', {
								type: 'button',
								className: 'dct-btn dct-btn-primary',
								disabled: busy || draft.trim() === '',
								onClick: submitEdit,
							}, busy ? t('edit.saving') : t('edit.send')))),
					document.body,
				));
		}
		//#endregion

		//#region compaction dock entry
		/**
		 * Manual compaction pill: runs the Session's `/compact` command, holds a
		 * brief busy state, and warns when the context meter is close to its cap.
		 * @param props - the command verbs, the standard session hooks, and the locale seat.
		 * @returns the dock pill, or null when the Session has no compaction command.
		 */
		function CompactButton({ t, ops, useSession, useProjection }) {
			const [available, setAvailable] = useState(null);
			const [busy, setBusy] = useState(false);
			const [failure, setFailure] = useState(null);
			const running = typeof useSession === 'function' ? useSession((snapshot) => snapshot.running === true) : false;
			const pressure = typeof useProjection === 'function' ? useProjection('contextPressure') : undefined;

			useEffect(() => {
				let active = true;
				Promise.resolve()
					.then(() => ops.available())
					.then((value) => {
						if (active) setAvailable(value !== false);
					}, () => {
						if (active) setAvailable(true);
					});
				return () => {
					active = false;
				};
			}, [ops]);

			useEffect(() => {
				if (failure === null) return;
				const timer = window.setTimeout(() => setFailure(null), 5000);
				return () => window.clearTimeout(timer);
			}, [failure]);

			const used = pressure?.projectedTokens ?? pressure?.pressureTokens;
			const percent = used !== undefined && pressure?.contextWindow !== undefined && pressure.contextWindow > 0
				? Math.round(used / pressure.contextWindow * 100)
				: null;
			const high = percent !== null && percent >= 75;
			const disabled = busy || running === true;

			const onClick = useCallback(() => {
				if (disabled) return;
				setBusy(true);
				setFailure(null);
				Promise.resolve()
					.then(() => ops.compact())
					.then((result) => {
						setBusy(false);
						if (result.ok) return;
						setFailure(result.message !== undefined && result.message !== ''
							? result.message
							: t(`compact.${result.code ?? 'failed'}`));
					}, () => {
						setBusy(false);
						setFailure(t('compact.failed'));
					});
			}, [disabled, ops, t]);

			if (available === false) return null;

			const label = busy ? t('compact.busy') : t('compact.action');
			const title = high && percent !== null ? t('compact.high', { percent }) : t('compact.title');
			return h('span', { className: 'dct-compact-root' },
				h('button', {
					type: 'button',
					className: 'dct-compact',
					title,
					'aria-label': t('compact.title'),
					'data-high': high || undefined,
					disabled,
					onClick,
				}, h(IconCompress, { key: 'icon' }), h('span', { key: 'label' }, label)),
				failure === null ? null : h('span', { className: 'dct-compact-error', role: 'status' }, failure));
		}
		//#endregion

		//#region host verbs
		/**
		 * Hand one verified absolute path to the Host desktop opener.
		 * @param ctx - the Client root context.
		 * @param path - absolute local path.
		 * @param action - `reveal` for the file manager, `open` for the default app.
		 * @returns the outcome, with a host error code when the call failed.
		 */
		async function openPath(ctx, path, action) {
			const session = remoteNamespace(ctx, 'session');
			if (session === undefined || typeof session.openWorkspacePath !== 'function') {
				return { ok: false, code: 'unavailable' };
			}
			try {
				const request = action === 'reveal' ? { path, action: 'reveal' } : { path };
				const carried = await session.openWorkspacePath(request);
				if (carried !== null && carried !== undefined && carried.ok === true) return { ok: true };
				const detail = carried?.error?.code;
				return { ok: false, code: 'failed', ...(typeof detail === 'string' ? { detail } : {}) };
			} catch (error) {
				const detail = error?.code ?? error?.message;
				return { ok: false, code: 'failed', ...(typeof detail === 'string' ? { detail } : {}) };
			}
		}

		/**
		 * Send an edited message: fork the Session before it, then admit the text.
		 *
		 * The fork keeps the original history intact while the new branch drops the
		 * replaced message and everything after it, which is the only Session
		 * operation that can express "change what I said back then".
		 * @param ctx - the Client root context.
		 * @param sessionId - Session the message belongs to.
		 * @param seq - event sequence of the replaced message, when known.
		 * @param text - edited text to admit.
		 * @returns the outcome, with `unavailable` before any Remote is ready.
		 */
		async function submitEdit(ctx, sessionId, seq, text) {
			const session = remoteNamespace(ctx, 'session');
			if (session === undefined || typeof session.prompt !== 'function') {
				return { ok: false, code: 'unavailable' };
			}
			let target = sessionId;
			let forked = false;
			if (typeof seq === 'number' && seq > 1 && typeof ctx.sessions?.fork === 'function') {
				try {
					const childId = await ctx.sessions.fork({ sessionId, atSeq: seq - 1, increaseTitle: true });
					if (typeof childId === 'string' && childId !== '') {
						target = childId;
						forked = true;
					}
				} catch (_error) {
					forked = false;
				}
			}
			try {
				const carried = await session.prompt({
					requestId: newRequestId(),
					sessionId: target,
					mode: 'queue',
					content: [{ type: 'text', text }],
				});
				if (carried === null || carried === undefined || carried.ok !== true) return { ok: false, code: 'failed' };
				if (forked) {
					try {
						ctx.get('uiWorkspace')?.openSession?.(target);
					} catch (_error) {
						/* the fork still holds the edited turn even when navigation fails */
					}
				}
				return { ok: true, forked };
			} catch (_error) {
				return { ok: false, code: 'failed' };
			}
		}

		/**
		 * Ask the Session's command catalog whether manual compaction exists.
		 * @param ctx - the Client root context.
		 * @param sessionId - Session whose catalog is read.
		 * @param cache - per-Session promise cache shared by every mount.
		 * @returns false only when a successful catalog read lacks `/compact`.
		 */
		function compactAvailable(ctx, sessionId, cache) {
			const known = cache.get(sessionId);
			if (known !== undefined) return known;
			const pending = (async () => {
				for (let attempt = 0; attempt < 6; attempt += 1) {
					const commands = remoteNamespace(ctx, 'commands');
					if (commands !== undefined && typeof commands.list === 'function') {
						try {
							const carried = await commands.list(sessionId);
							if (carried !== null && carried !== undefined && carried.ok === true && Array.isArray(carried.value)) {
								return carried.value.some((descriptor) => descriptor?.name === 'compact');
							}
						} catch (_error) {
							/* an unreadable catalog keeps the button rather than hiding it */
						}
						return true;
					}
					await new Promise((resolve) => setTimeout(resolve, 300));
				}
				return true;
			})();
			cache.set(sessionId, pending);
			return pending;
		}

		/**
		 * Run one manual compaction through the Session's existing command.
		 * @param ctx - the Client root context.
		 * @param sessionId - Session to compact.
		 * @returns the outcome with a host-supplied message when the command refused.
		 */
		async function runCompact(ctx, sessionId) {
			const commands = remoteNamespace(ctx, 'commands');
			if (commands === undefined || typeof commands.execute !== 'function') {
				return { ok: false, code: 'unavailable' };
			}
			try {
				const carried = await commands.execute(sessionId, '/compact', []);
				if (carried === null || carried === undefined || carried.ok !== true) return { ok: false, code: 'failed' };
				const executed = carried.value;
				if (executed === undefined || executed === null) return { ok: false, code: 'unavailable' };
				const outcome = executed.result;
				if (outcome !== undefined && outcome !== null && outcome.kind === 'error') {
					return { ok: false, code: 'failed', message: typeof outcome.text === 'string' ? outcome.text : '' };
				}
				return { ok: true };
			} catch (_error) {
				return { ok: false, code: 'failed' };
			}
		}
		//#endregion

		/** Required services: the slot registry, Session browsing, and copy. */
		const inject = ['slots', 'sessions', 'locale'];

		/**
		 * Mount the two additive entries and their dictionaries.
		 * @param ctx - Client root context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'conversation-tools: dictionaries');
			ctx.effect(() => installStyles(), 'conversation-tools: styles');

			const compactCommands = new Map();

			ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
				name: 'conversation.input.overlay',
				id: 'conversation-tools',
				order: 4,
				locale: NS,
				inject: (sessionId) => ({
					ops: {
						cwd: () => currentCwd(ctx, sessionId),
						openPath: (path, action) => openPath(ctx, path, action),
						submitEdit: (request) => submitEdit(ctx, sessionId, request.seq, request.text),
					},
				}),
			}, ConversationToolsOverlay));

			ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
				name: 'conversation.composer.dock',
				id: 'context-compact',
				order: 2,
				locale: NS,
				inject: (sessionId) => ({
					ops: {
						available: () => compactAvailable(ctx, sessionId, compactCommands),
						compact: () => runCompact(ctx, sessionId),
					},
				}),
			}, CompactButton));
		}

		return { inject, apply };
	},
});
