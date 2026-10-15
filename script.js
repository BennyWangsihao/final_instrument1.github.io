"use strict";

/*
  Loop Together — script.js
  Part 1: shows the commit history table (index.html)
  Part 2: runs the two-track sampler (instrument.html)
*/

const $ = selector => document.querySelector(selector);


/* ========== Part 1: commit history ========== */

// Split CSV text into rows of cells.
// A cell in "quotes" may contain commas and new lines; "" inside it means one quote mark.
function parseCSV(text) {
  const rows = [[""]];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const row = rows[rows.length - 1];
    if (char === '"' && quoted && text[i + 1] === '"') { row[row.length - 1] += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) row.push("");
    else if (char === "\n" && !quoted) rows.push([""]);
    else if (char !== "\r" || quoted) row[row.length - 1] += char;
  }
  return rows.filter(row => row.join("").trim() !== ""); // drop blank lines
}

// Load commit_history.csv and show it as a table. If the file is missing, say so.
async function showCommitHistory() {
  const status = $("#history-status");
  try {
    const response = await fetch("commit_history.csv", { cache: "no-store" });
    if (!response.ok) throw new Error("Final commit history has not been added yet. Add commit_history.csv beside index.html.");

    const rows = parseCSV(await response.text());
    if (!/^author( name)?$/i.test(rows[0]?.[0].trim())) {
      rows.unshift(["Author", "Author Date", "Subject", "Body"]); // add a header row if missing
    }

    const table = $("#history-table");
    const head = table.createTHead();
    const body = table.createTBody();
    rows.forEach((cells, i) => {
      const tr = (i === 0 ? head : body).insertRow();
      cells.forEach(text => {
        const cell = document.createElement(i === 0 ? "th" : "td");
        cell.textContent = text; // shown as plain text, never as HTML
        tr.append(cell);
      });
    });

    status.textContent = `${rows.length - 1} commit records loaded from the final version CSV.`;
    $("#history-download").hidden = false;
  } catch (error) {
    status.textContent = error.message;
  }
}
