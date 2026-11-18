// node --test planner/test/markdown.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, plainText } from '../public/js/markdown.js';

test('headings, paragraphs, inline styles and safe links', () => {
  const html = renderMarkdown('## Processed 2026-11-18\n\n### Diary\nI want **this** and _that_ with `code`.\nSecond line.\n\nSee [the filing](https://sec.gov/x) or https://example.com/y.');
  assert.match(html, /<h2>Processed 2026-11-18<\/h2>/);
  assert.match(html, /<h3>Diary<\/h3>/);
  assert.match(html, /<p>I want <strong>this<\/strong> and <em>that<\/em> with <code>code<\/code>.<br>Second line.<\/p>/);
  assert.match(html, /<a href="https:\/\/sec.gov\/x" target="_blank" rel="noopener noreferrer">the filing<\/a>/);
  assert.match(html, /<a href="https:\/\/example.com\/y" [^>]*>https:\/\/example.com\/y<\/a>\.<\/p>/);
});

test('lists, tasks, tables, quotes and rules', () => {
  const html = renderMarkdown('- one\n- two\n  continued\n1. first\n2) second\n- [ ] todo\n- [x] done\n\n| When | What |\n| --- | --- |\n| 9:00 | Review |\n| 14:00 | Sketch \\| plan |\n\n> quoted\n\n---');
  assert.match(html, /<ul><li>one<\/li><li>two continued<\/li><\/ul>/);
  assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
  assert.match(html, /<li class="task">todo<\/li><li class="task done">done<\/li>/);
  assert.match(html, /<table><thead><tr><th>When<\/th><th>What<\/th><\/tr><\/thead><tbody><tr><td>9:00<\/td><td>Review<\/td><\/tr>/);
  assert.match(html, /<blockquote><p>quoted<\/p><\/blockquote>/);
  assert.match(html, /<hr>/);
});

test('nothing in the input becomes markup', () => {
  const html = renderMarkdown('<script>alert(1)</script> [x](javascript:alert(1)) <img src=x onerror=1>');
  assert.doesNotMatch(html, /<script|<img|href="javascript/);
  assert.match(html, /&lt;script&gt;/);
  assert.equal(plainText('### Diary\n**bold** [l](http://x)'), 'Diary bold l');
});
