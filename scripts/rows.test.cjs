/**
 * Focused checks for the flow-kind helpers that decide where the edit control appears.
 * The region is extracted from client.js so this test cannot drift from the shipped source.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'client.js'), 'utf8');
const start = source.indexOf('//#region editable rows');
const end = source.indexOf('//#endregion', start);
if (start < 0 || end < 0) throw new Error('editable rows region not found');
const region = source.slice(start, end);

const factory = new Function(`${region}\nreturn { EDITABLE_FLOW_KINDS, EDITABLE_ROW_SELECTOR, isEditableFlowKind };`);
const helpers = factory();

let failures = 0;
const check = (label, actual, expected) => {
	const ok = actual === expected;
	if (!ok) failures += 1;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} -> ${JSON.stringify(actual)}${ok ? '' : ` expected ${JSON.stringify(expected)}`}`);
};

// A normal message and a mid-turn (steering) message both render a user bubble.
check('user row editable', helpers.isEditableFlowKind('user'), true);
check('steering row editable', helpers.isEditableFlowKind('steering'), true);
check('assistant row skipped', helpers.isEditableFlowKind('assistant-step'), false);
check('turn tail skipped', helpers.isEditableFlowKind('turn-tail'), false);
check('missing kind skipped', helpers.isEditableFlowKind(null), false);

// The selector must cover exactly the kinds the helper accepts.
check(
	'selector covers both kinds',
	helpers.EDITABLE_ROW_SELECTOR,
	'[data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]',
);
for (const kind of helpers.EDITABLE_FLOW_KINDS) {
	check(`selector contains ${kind}`, helpers.EDITABLE_ROW_SELECTOR.includes(`"${kind}"`), true);
}

console.log(failures === 0 ? 'row tests: ok' : `row tests: ${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
