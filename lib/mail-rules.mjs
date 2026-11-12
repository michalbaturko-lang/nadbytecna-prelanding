// Local deterministic hints only. Message content is untrusted data, never instructions.
export const MAIL_RULES_VERSION = "2026-11-12-v2";
export const MAIL_LABEL_CATALOG = Object.freeze([
  ["personal_story", "Osobní příběh"], ["request_help", "Žádost o pomoc"],
  ["offer_help", "Nabídka pomoci"], ["press", "Média"], ["partnership", "Spolupráce"],
  ["operational", "Provoz"], ["newsletter", "Newsletter"], ["automated", "Automatická zpráva"],
  ["work", "Práce"], ["legal", "Právní pomoc"], ["psychological_support", "Psychická podpora"],
  ["payment_change", "Změna platebních údajů"], ["verify", "Ověřit"], ["review", "Ke kontrole"],
  ["attachment", "Příloha"], ["spam", "Spam"], ["suspected_fraud", "Podezření na podvod"], ["other", "Ostatní"],
].map(([code, name]) => Object.freeze({ code, name })));
export const MAIL_LABEL_CODES = new Set(MAIL_LABEL_CATALOG.map(label => label.code));
export const mailRulesEnabled = (env = process.env) => env.MAIL_RULES_ENABLED !== "false";

const fold = value => String(value || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const address = value => typeof value === "string" ? value.trim().toLowerCase() : "";
const validAddress = value => typeof value === "string" && value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(value);

export function blockedMailSenders(env = process.env) {
  if (!env.MAIL_RULES_BLOCKED_SENDERS) return [];
  let values;
  try { values = JSON.parse(env.MAIL_RULES_BLOCKED_SENDERS); } catch { throw new Error("mail_rules_configuration"); }
  if (!Array.isArray(values) || values.length > 200 || !values.every(validAddress))
    throw new Error("mail_rules_configuration");
  return [...new Set(values.map(address))];
}

export function classifyMailRules(snapshot, { blockedSenders = [] } = {}) {
  const rawMessages = Array.isArray(snapshot?.messages) ? snapshot.messages : [];
  const messages = rawMessages.slice(-10);
  const labels = new Map();
  const add = (code, reason) => labels.set(code, { code, reason });
  let protectedContent = false, forwarded = false, suspicious = false;
  let incomplete = snapshot?.context_truncated !== false || !Number.isSafeInteger(snapshot?.message_count) ||
    snapshot.message_count !== messages.length || rawMessages.length > 10 || !messages.length;
  for (const message of messages) {
    // The DB worker supplies a bounded snapshot. Keep the pure helper bounded too.
    const subject = fold(String(message.subject || "").slice(0, 512));
    const body = fold(String(message.body_text || "").slice(0, 20000));
    const text = subject + "\n" + body;
    if (String(message.body_text || "").length > 20000 || String(message.subject || "").length > 512 || message.body_truncated === true) incomplete = true;
    const sender = address(message.sender_email);
    const help = /\b(?:prosim\s+(?:vas\s+)?o\s+pomoc|potrebuji\s+(?:(?:pravni|psychickou|vasi|financni)\s+)?pomoc|potrebuji\s+poradit|muzete\s+mi\s+(?:pomoci|poradit)|hledam\s+praci|nevim[, ]+kam\s+se\s+obratit|prosim(?:\s+vas)?[, ]+(?:pomozte|poradte)(?:\s+mi)?|pomozte\s+mi|uz\s+to\s+(?:sama?\s+)?nezvladam|nechci\s+zit|uvazuji\s+o\s+sebevrazde|i\s+need\s+help|please\s+help)\b/u.test(text);
    const story = /\b(?:muj\s+(?:(?:osobni|zivotni)\s+)?pribeh|moj\s+(?:(?:osobny|zivotny)\s+)?pribeh|rada\s+bych\s+(?:se\s+)?(?:podelila|sdilela)|(?:dostala|dostal)\s+som\s+vypoved|prisla\s+som\s+o\s+pracu|dostal[ae]?\s+jsem\s+vypoved|vypoved\s+jsem\s+dostala|pris(?:la|el)\s+jsem\s+o\s+praci|prozil[ae]\s+jsem\s+(?:neco\s+)?podobneho|stal[ae]?\s+jsem\s+se\s+nadbytecn|propustili\s+me|po\s+\d+\s+letech\s+(?:jsem|me))/.test(text);
    const offer = /\b(?:nabidka\s+(?:(?:pravni|psychologicke|odborne)\s+)?pomoci|nabizim\s+(?:vam\s+)?pomoc|rada\s+bych\s+(?:vam\s+)?nabidla\s+(?:pravni\s+)?pomoc|ponukam\s+(?:vam\s+)?pomoc|chcem\s+pomahat|mohu\s+(?:vam\s+)?(?:pomoci|nabidnout)|rad[ae]?\s+bych\s+(?:vam\s+)?pomohl[ae]?|chci\s+pomahat|nabizime\s+(?:bezplatnou\s+)?pomoc)\b/u.test(text);
    if (help) add("request_help", "Text obsahuje osobní žádost o pomoc; ověřte konkrétní potřebu.");
    if (story) add("personal_story", "Text obsahuje znaky vlastního osobního příběhu.");
    if (offer) add("offer_help", "Text obsahuje výslovnou nabídku pomoci.");
    protectedContent ||= help || story || offer;
    if (/\b(?:rozhovor|tiskovy\s+dotaz|dotaz\s+pro\s+media|nabidka\s+reportaze)\b/u.test(subject) ||
        /\b(?:jsem\s+redaktor\w*|jsem\s+novinar\w*|tlacovych\s+sprav|tiskovych\s+zprav|do\s+(?:dnesneho|dnesniho|pripravovaneho)\s+clanku|pripravuji\s+reportaz|radi\s+bychom\s+(?:rozhovor|natocili))/u.test(body))
      add("press", "Předmět nebo formulace naznačují mediální dotaz; toto není ověření identity odesílatele.");
    if (/\b(?:nabidka\s+spoluprace|navazat\s+spolupraci|nabidka\s+partnerstvi|nabidk\w*\s+(?:sve\s+)?profesni\s+spoluprace)\b/u.test(text))
      add("partnership", "Text zmiňuje nabídku spolupráce nebo partnerství.");
    if (/\b(?:potvrzeni\s+terminu|organizace\s+akce|podklady\s+pro|termin\s+schuzky)\b/u.test(text))
      add("operational", "Text zmiňuje organizační podklady nebo domluvu termínu.");
    if (/\b(?:unsubscribe|odhlasit\s+(?:se\s+)?z\s+odberu|zrusit\s+odber|odhlaseni\s+z\s+odberu|zrusit\s+zasilani|odhlasit\s+odber|odhlasenie|manage\s+(?:your\s+)?(?:email\s+)?preferences|email\s+preferences)\b/u.test(body))
      add("newsletter", "Text obsahuje odhlašování z odběru; samotné toto označení neznamená spam.");
    if (/^(?:no[._-]?reply(?:[._-][a-z0-9]+)*|do[._-]?not[._-]?reply|mailer-daemon)@/u.test(sender) ||
        /\b(?:automaticka\s+odpoved|automatic\s+reply|out\s+of\s+office|delivery\s+status|potvrzeni\s+objednavky|potvrzeni\s+platby|vase\s+zasilka|nedorucitelna\s+zprava)\b/u.test(subject))
      add("automated", "Adresa nebo předmět odpovídají automatické zprávě; příchozí obsah zůstává dostupný.");
    if (/\b(?:prace|praci|vypoved\w*|zamestnan\w*|propustili|nadbytecnost)\b/u.test(text))
      add("work", "Text zmiňuje práci nebo zaměstnání.");
    if (/\b(?:pravni|pravnik|advokat|soud|odstupne)\b/u.test(text))
      add("legal", "Text zmiňuje právní téma.");
    if (/\b(?:terapie|terapeut|psycholog|psychicka\s+podpora|psychickou\s+pomoc)\b/u.test(text))
      add("psychological_support", "Text zmiňuje psychickou nebo terapeutickou podporu.");
    const payment = /\b(?:uctu|ucet|iban|bankovn\w*|vyplat\w*)\b/u.test(text) && /\b(?:zmen\w*|novy|nove|nahradit|aktualizace)\b/u.test(text);
    if (payment) {
      add("payment_change", "Text zmiňuje změnu platebních údajů; ověřte ji nezávislou cestou.");
      add("verify", "Platební změna vyžaduje lidské ověření; žádná platba ani změna účtu se neprovádí.");
      suspicious = true;
    }
    const credentialCall = /\b(?:heslo|password|prihlaseni|prihlaste|overte|potvrdte|zablokovany|suspend)\b/u.test(text);
    const linkCall = /https?:\/\/|\b(?:kliknete|odkaz|link)\b/u.test(text);
    const accountContext = /\b(?:ucet|uctu|banky|banka|bankovni|platba|platby|bezpecnost|heslo|password)\b/u.test(text);
    if (credentialCall && linkCall && accountContext) {
      add("suspected_fraud", "Kombinace přihlašovací nebo platební výzvy a odkazu vyžaduje ověření; nejde o potvrzený podvod.");
      add("verify", "Ověřte původ zprávy a výzvu v ní před jakoukoli akcí.");
      suspicious = true;
    }
    forwarded ||= /^(?:re:\s*)?(?:fwd?|preposlano):/u.test(subject) || /\b(?:preposilam|podezrely\s+e-?mail|upozorneni\s+na\s+podvod)\b/u.test(body);
    if (message.has_attachments === true) add("attachment", "Zpráva obsahuje přílohu; soubor se tímto tříděním neotevírá.");
  }
  // Internet headers supplied in message bodies/objects are deliberately ignored. Trusted
  // Microsoft verdict metadata has not yet been added to the ingestion contract.
  const blocked = new Set(blockedSenders.filter(validAddress).map(address));
  const matches = messages.filter(message => blocked.has(address(message.sender_email))).length;
  let disposition = "normal", reason = "Místní orientační třídění podle pevných pravidel.";
  if (messages.length === 1 && matches === messages.length && matches > 0 && !incomplete && !protectedContent && !forwarded && !suspicious) {
    add("spam", "Všichni odesílatelé úplného vlákna odpovídají ručně nastavenému seznamu blokovaných adres.");
    disposition = "suspect";
    reason = "Shoda s výslovně nastaveným seznamem blokovaných adres; kopie zpráv zůstávají uložené.";
  } else if (protectedContent || suspicious || forwarded || incomplete || matches > 0) {
    disposition = "review";
    reason = incomplete ? "Kontext vlákna není úplný; nelze bezpečně odfiltrovat celé vlákno."
      : suspicious ? "Platební nebo přihlašovací výzva vyžaduje lidské ověření."
      : protectedContent ? "Možný příběh nebo žádost či nabídka pomoci vyžaduje lidské posouzení."
      : "Smíšený nebo přeposlaný kontext vyžaduje lidské posouzení.";
    add("review", reason);
  }
  if (!labels.size || [...labels.keys()].every(code => ["attachment", "verify", "review", "work", "legal", "psychological_support"].includes(code))) {
    add("other", "Druh zprávy nelze spolehlivě určit pevnými pravidly.");
    if (disposition === "normal") {
      disposition = "review";
      reason = "Druh zprávy je neurčitý; zpráva zůstává viditelná ke kontrole.";
      add("review", reason);
    }
  }
  return { version: MAIL_RULES_VERSION, labels: MAIL_LABEL_CATALOG.flatMap(({code}) => labels.has(code) ? [labels.get(code)] : []), disposition, reason };
}
