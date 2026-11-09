import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getAcceptedWordEditState } from "@/lib/firebase/acceptedWordEdit";
import { getCanonicalWordCandidates } from "@/lib/firebase/canonicalWord";

test("accepted word correction controls appear only for a valid distinct proposal", () => {
  assert.deepEqual(getAcceptedWordEditState("River safety", "river safety", undefined), { hasDraft: false, canConfirm: false, canCancel: false });
  assert.deepEqual(getAcceptedWordEditState("River safety", "river safety", "RIVER SAFETY"), { hasDraft: true, canConfirm: true, canCancel: true });
  assert.deepEqual(getAcceptedWordEditState("River safety", "river safety", "River safety"), { hasDraft: true, canConfirm: false, canCancel: true });
  assert.deepEqual(getAcceptedWordEditState("River safety", "river safety", " \t"), { hasDraft: true, canConfirm: false, canCancel: true });
  assert.deepEqual(getAcceptedWordEditState("River safety", "river safety", "Different stable ID"), { hasDraft: true, canConfirm: false, canCancel: true });
});

test("canonical options stay within the current accepted-word group", () => {
  assert.deepEqual(
    getCanonicalWordCandidates("Community garden", ["Community garden", "Neighborhood garden"]),
    ["Community garden", "Neighborhood garden"],
  );
});

test("accepted word row keeps editing, canonical selection, count, and delete in one aligned layout", async () => {
  const [component, css] = await Promise.all([
    readFile(new URL("../components/SkyPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  const rowStart = component.indexOf('<div className="accepted-word-row">');
  const rowEnd = component.indexOf("{visibleAcceptedMergeSuggestions", rowStart);
  const acceptedRow = component.slice(rowStart, rowEnd);
  assert.ok(rowStart >= 0 && rowEnd > rowStart, "accepted-word row markup is present");
  assert.match(acceptedRow, /className="accepted-word-controls"[\s\S]*?<input[\s\S]*?<select[\s\S]*?className="canonical-form-select"/u);
  assert.match(acceptedRow, /onChange=\{\(event\) => void handleChooseCanonicalWordForm\(word, event\.target\.value\)\}/u);
  assert.doesNotMatch(acceptedRow.match(/<select[\s\S]*?<\/select>/u)?.[0] ?? "", /handleUpdateAcceptedWord/u);
  assert.match(acceptedRow, /aria-label=\{`Editar ideia aceita:/u);
  assert.match(acceptedRow, /aria-label=\{`Escolher representação de/u);
  assert.match(acceptedRow, /aria-label=\{`Confirmar correção de/u);
  assert.match(acceptedRow, /aria-label=\{`Cancelar correção de/u);
  assert.match(acceptedRow, /className="merge-count"/u);
  assert.match(component, /className="word-count"/u);
  assert.match(component, /className="[^"]*remove-word-button/u);

  assert.match(css, /\.accepted-word-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*3rem;/u);
  assert.match(css, /\.accepted-word-controls\s*\{[^}]*display:\s*flex;/u);
  assert.match(css, /\.accepted-word-controls input\s*\{[^}]*min-width:\s*2rem;/u);
  assert.match(css, /\.accepted-word-controls \.canonical-form-select\s*\{[^}]*max-width:\s*36%;/u);
  assert.match(css, /\.accepted-clean-word\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*52px\s*28px;/u);
  assert.match(css, /\.accepted-clean-word \.word-count,[\s\S]*?\.accepted-clean-word \.merge-count\s*\{[^}]*white-space:\s*nowrap;/u);
  assert.doesNotMatch(css, /\.accepted-word-edit\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/u);
});
