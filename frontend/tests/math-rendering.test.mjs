import { test } from "node:test";
import assert from "node:assert/strict";
import katex from "katex";

test("the patched math renderer retains HTML and accessible MathML output", () => {
  assert.equal(katex.version, "0.18.2");
  const html = katex.renderToString("\\frac{1}{2}", { throwOnError: false });
  assert.match(html, /class="katex-html"/);
  assert.match(html, /<mfrac>/);
  assert.match(html, /class="katex-base"/);
});

test("inherited trust settings cannot enable untrusted math links", () => {
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, "trust");
  Object.defineProperty(Object.prototype, "trust", { value: true, writable: true, configurable: true });
  try {
    const html = katex.renderToString("\\href{https://synthetic.example/record}{record}", {});
    assert.doesNotMatch(html, /<a\b|href="https:\/\/synthetic.example/);
  } finally {
    if (previous) Object.defineProperty(Object.prototype, "trust", previous);
    else delete Object.prototype.trust;
  }
});
