import { PDFDocument } from "pdfkit";
import { fileURLToPath } from "node:url";

const regular = fileURLToPath(new URL("../assets/pdf/Jost-Regular.ttf", import.meta.url));
const medium = fileURLToPath(new URL("../assets/pdf/Jost-Medium.ttf", import.meta.url));
const ink = "#302a33", rose = "#873c5b", muted = "#887c85", line = "#e7dce1";

// A reading copy: never include contacts, notes, internal classification or signed media URLs.
export function storyPdfContent(row) {
  const offer = row.entity === "help_offers";
  const kind = offer ? "Nabídka pomoci" : "Příběh";
  const author = row.anonymous ? "Anonymní příběh" : String(row.full_name || "Příběh bez uvedeného jména");
  const body = String(row.body || "").trim();
  const transcript = String(row.transcript || "").trim();
  const paragraphs = body ? body.split(/\r?\n\s*\r?\n/u) : [];
  let title = offer ? "Nabídka pomoci" : "Sdílený příběh", deck = "";
  // Use only the author's own short opening; do not invent a title or summarize the story.
  if (!offer && paragraphs.length > 1 && paragraphs[0].length <= 180 && !paragraphs[0].includes("\n")) {
    const opening = paragraphs.shift();
    const sentences = opening.match(/^(.{10,110}?[.!?])\s+(.+)$/u);
    if (sentences && sentences[2].length <= 100) [title, deck] = sentences.slice(1);
    else title = opening;
  }
  const date = new Date(row.created_at);
  return {
    author, title, deck, paragraphs, transcript, kind, offer,
    date: Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("cs-CZ", {
      timeZone: "Europe/Prague", day: "numeric", month: "numeric", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }).format(date) : "",
    audioOnly: !body && !transcript && Boolean(row.audio_path || row.input_type === "recording" || row.input_type === "upload"),
  };
}

export async function createStoryPdf(row) {
  const content = storyPdfContent(row);
  const doc = new PDFDocument({
    size: "A4", margin: 62, bufferPages: true, autoFirstPage: false, font: regular,
    info: { Title: `${content.author} | ${content.kind}`, Author: content.author, Creator: "Nadbytečná" },
  });
  const chunks = [];
  const done = new Promise((resolve, reject) => {
    doc.on("data", chunk => chunks.push(chunk));
    doc.once("error", reject);
    doc.once("end", () => resolve(Buffer.concat(chunks)));
  });
  doc.registerFont("Jost", regular);
  doc.registerFont("JostMedium", medium);
  const left = 62, width = 471.28, bottom = 782;
  let y = 0;
  function text(value, x, at, size, color = ink, font = "Jost", options = {}) {
    doc.font(font).fontSize(size).fillColor(color).text(value, x, at, { lineBreak: false, ...options });
  }
  function rule(at) { doc.moveTo(left, at).lineTo(left + width, at).lineWidth(.6).strokeColor(line).stroke(); }
  function wrap(value, size, font, available = width) {
    doc.font(font).fontSize(size);
    const lines = [];
    for (const hardLine of value.replace(/\r\n?/gu, "\n").split("\n")) {
      let current = "";
      for (const word of hardLine.split(/\s+/u).filter(Boolean)) {
        if (current && doc.widthOfString(current + " " + word) > available) { lines.push(current); current = ""; }
        if (doc.widthOfString(word) > available) {
          if (current) { lines.push(current); current = ""; }
          for (const character of Array.from(word)) {
            if (current && doc.widthOfString(current + character) > available) { lines.push(current); current = ""; }
            current += character;
          }
        } else current += (current ? " " : "") + word;
      }
      lines.push(current);
    }
    return lines;
  }
  function page(first = false) {
    doc.addPage();
    if (first) {
      text("NADBYTEČNÁ", left, 57, 8, rose, "JostMedium", { characterSpacing: 1.8 });
      text(content.offer ? "NABÍDKA POMOCI" : "OSOBNÍ PŘÍBĚH", 418, 57, 7.6, muted, "JostMedium", { characterSpacing: 1 });
      rule(78);
      y = 99;
    } else {
      const name = wrap(content.author, 8, "Jost")[0];
      text(name, left, 57, 8, muted);
      text(content.offer ? "NADBYTEČNÁ / POMOC" : "NADBYTEČNÁ / PŘÍBĚHY", 398, 57, 7.6, muted);
      rule(78); y = 98;
    }
  }
  function block(value, { size = 11.1, leading = 15.35, gap = 6.3, font = "Jost", color = ink, quote = false, keep = true } = {}) {
    const inset = quote ? 14 : 0;
    const lines = wrap(value, size, font, width - inset);
    const height = lines.length * leading;
    if (keep && height <= bottom - 98 && y + height > bottom) page();
    let index = 0;
    while (index < lines.length) {
      let capacity = Math.floor((bottom - y) / leading);
      if (capacity < Math.min(2, lines.length - index)) { page(); capacity = Math.floor((bottom - y) / leading); }
      let count = Math.min(capacity, lines.length - index);
      if (lines.length - index - count === 1 && count > 2) count--;
      const start = y;
      for (let i = 0; i < count; i++) {
        text(lines[index++], left + inset, y, size, color, font);
        y += leading;
      }
      if (quote) doc.moveTo(left, start + 2).lineTo(left, y - 2).lineWidth(1.5).strokeColor("#b66b89").stroke();
      if (index < lines.length) page();
    }
    y += gap;
  }
  try {
    page(true);
    block(content.author, { size: 13.5, leading: 18, gap: 4, font: "JostMedium", color: rose });
    if (content.date) block(content.date, { size: 8, leading: 11, gap: 17, color: muted });
    block(content.title, { size: 27.5, leading: 31, gap: content.deck ? 8 : 20, font: "JostMedium" });
    if (content.deck) block(content.deck, { size: 15.3, leading: 20, gap: 20, color: rose });
    content.paragraphs.forEach((paragraph, i) => {
      const prior = content.paragraphs[i - 1];
      const quote = paragraph.length >= 65 && paragraph.length <= 120 && prior && prior.length < 40;
      block(paragraph, quote ? { size: 16, leading: 21.6, gap: 13, color: rose, font: "JostMedium", quote: true }
        : paragraph.length < 65 ? { font: "JostMedium" } : {});
    });
    if (content.transcript) {
      if (content.paragraphs.length) y += 10;
      block("Přepis AI, může obsahovat chyby", { font: "JostMedium", color: rose });
      for (const paragraph of content.transcript.split(/\r?\n\s*\r?\n/u)) block(paragraph);
    }
    if (content.audioOnly) {
      block("Příběh je uložený jako zvuková nahrávka. Textový přepis není k dispozici.");
      block("Nahrávku lze přehrát v přihlášeném adminu.", { color: muted });
    } else if (!content.paragraphs.length && !content.transcript && content.title === "Sdílený příběh") {
      block("Text příběhu není k dispozici.");
    }
    const { count } = doc.bufferedPageRange();
    for (let i = 0; i < count; i++) {
      doc.switchToPage(i);
      text("NADBYTEČNÁ", left, 811, 7, muted);
      text(`${i + 1} / ${count}`, left + width - 30, 811, 7, muted);
    }
    doc.end();
    return { bytes: await done, pages: count };
  } catch (error) {
    doc.destroy(error);
    await done.catch(() => {});
    throw error;
  }
}
