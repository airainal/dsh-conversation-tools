/**
 * Focused checks for the path syntax helpers of the Client half.
 * The helpers are extracted from client.js between the `path syntax` region
 * markers so this test can never drift from the shipped source.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'client.js'), 'utf8');
const start = source.indexOf('//#region path syntax');
const end = source.indexOf('//#endregion', start);
if (start < 0 || end < 0) throw new Error('path syntax region not found');
const region = source.slice(start, end);

const factory = new Function(`${region}\nreturn { isAbsolutePath, separatorFor, normalizePath, joinPath, resolveAuthoredPath, looksLikePath, filePathFor };`);
const helpers = factory();

const cases = [
	['C:\\Work\\demo\\src\\index.ts', 'C:\\Work\\demo', 'C:\\Work\\demo\\src\\index.ts'],
	['src/index.ts', 'C:\\Work\\demo', 'C:\\Work\\demo\\src\\index.ts'],
	['./src/../src/./main.ts', 'C:\\Work\\demo', 'C:\\Work\\demo\\src\\main.ts'],
	['/home/u/demo/a.txt', '/home/u/demo', '/home/u/demo/a.txt'],
	['a/b/c.md', '/home/u/demo', '/home/u/demo/a/b/c.md'],
	['file:///C:/Work/demo/a%20b.txt', undefined, 'C:\\Work\\demo\\a b.txt'],
	['https://example.com/a.ts', 'C:\\Work\\demo', null],
	['not a path', undefined, null],
];

let failures = 0;
for (const [raw, cwd, expected] of cases) {
	const actual = helpers.resolveAuthoredPath(raw, cwd);
	const ok = actual === expected;
	if (!ok) failures += 1;
	console.log(`${ok ? 'ok  ' : 'FAIL'} resolve(${JSON.stringify(raw)}, ${JSON.stringify(cwd)}) -> ${JSON.stringify(actual)}${ok ? '' : ` expected ${JSON.stringify(expected)}`}`);
}

const link = (title, text) => ({
	getAttribute: (name) => (name === 'title' ? title : null),
	textContent: text,
});
const linkCases = [
	[link('%s', 'docs/guide.md', 'docs/guide.md')],
];

// filePathFor: title wins, bare prose without a path shape is rejected.
const titleWins = helpers.filePathFor(link('C:\\Work\\demo\\a.txt', 'a.txt'), 'C:\\X');
const relative = helpers.filePathFor(link('', 'docs/guide.md'), 'C:\\Work\\demo');
const prose = helpers.filePathFor(link('', 'hello world'), 'C:\\Work\\demo');
const noTitle = helpers.filePathFor(link('', 'notes.md'), 'C:\\Work\\demo');

const check = (label, actual, expected) => {
	const ok = actual === expected;
	if (!ok) failures += 1;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} -> ${JSON.stringify(actual)}${ok ? '' : ` expected ${JSON.stringify(expected)}`}`);
};
check('title wins', titleWins, 'C:\\Work\\demo\\a.txt');
check('relative authored path', relative, 'C:\\Work\\demo\\docs\\guide.md');
check('prose rejected', prose, null);
check('bare file name joined with cwd', noTitle, 'C:\\Work\\demo\\notes.md');
check('drive is absolute', helpers.isAbsolutePath('C:\\x'), true);
check('scheme-ish drive kept relative', helpers.resolveAuthoredPath('C:temp', 'C:\\Work'), 'C:\\Work\\C:temp');

console.log(failures === 0 ? 'path tests: ok' : `path tests: ${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
