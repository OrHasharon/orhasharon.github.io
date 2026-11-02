// Google Apps Script that sends the WorshipAndSound invitation emails (from the account that deploys it).
// Deploy: script.google.com -> New project -> paste this -> Deploy -> New deployment -> Web app,
// Execute as: Me, Who has access: Anyone -> Deploy -> copy the Web app URL into ws.js (INVITE_HOOK).
// It only ever emails addresses stored in the database for a real invite token, so the URL can't be used to spam.

const SB = "https://pualpwrkztjzhgpaqudm.supabase.co";
const KEY = "sb_publishable_TFMMqLxLWHatd3lXYrUlTQ_aO7MvaQ9";
const SITE = "https://orhasharon.github.io/WorshipAndSound/respond.html";
const ROLES = { leader: "הובלת הלל", musician: "נגינה / שירה", sound: "סאונד", setup: "הקמת סאונד" };

function doPost(e) {
  const d = JSON.parse(e.postData.contents || "{}");
  const inv = details(d.token);
  if (!inv) return out("no such invite");
  const when = inv.meeting_date.split("-").reverse().join("/");
  const what = ROLES[inv.role] + (inv.instrument ? ` (${inv.instrument})` : "");
  if (d.type === "invite" && inv.status === "pending" && inv.member_email) {
    const yes = `${SITE}?t=${d.token}&a=yes`, no = `${SITE}?t=${d.token}&a=no`;
    MailApp.sendEmail({
      to: inv.member_email,
      name: "צוותי הלל וסאונד · אור השרון",
      subject: `הזמנה לשיבוץ · ${when} · ${what}`,
      htmlBody: `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6">
        <p>שלום ${inv.member_name},</p>
        <p><b>${d.from || inv.invited_by}</b> מזמין/ה אותך למפגש ב-<b>${when}</b>: <b>${what}</b>.</p>
        <p><a href="${yes}" style="background:#2c7a66;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:bold">✔ מאשר/ת</a>
           &nbsp; <a href="${no}" style="background:#b3261e;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:bold">✖ לא אוכל</a></p>
        <p style="color:#777;font-size:13px">קהילת אור השרון · צוותי הלל וסאונד</p></div>`,
    });
    return out("sent");
  }
  if (d.type === "answer" && inv.response && inv.invited_by) {
    const ok = inv.response === "accepted";
    MailApp.sendEmail({
      to: inv.invited_by,
      name: "צוותי הלל וסאונד · אור השרון",
      subject: `${inv.member_name} ${ok ? "אישר/ה" : "לא יוכל/תוכל"} · ${when} · ${what}`,
      htmlBody: `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6">
        <p><b>${inv.member_name}</b> ${ok ? "אישר/ה את השיבוץ" : "ביטל/ה את השיבוץ"} למפגש ב-${when}: ${what}.</p>
        ${!ok && inv.reason ? `<p>הסיבה: ${inv.reason}</p>` : ""}
        <p><a href="https://orhasharon.github.io/WorshipAndSound/">לאתר השיבוצים</a></p></div>`,
    });
    return out("sent");
  }
  return out("nothing to do");
}

function details(token) {
  if (!/^[0-9a-f-]{36}$/i.test(token || "")) return null;
  const r = UrlFetchApp.fetch(`${SB}/rest/v1/rpc/invite_details`, {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Profile": "or_hasharon_worship", "Accept-Profile": "or_hasharon_worship" },
    payload: JSON.stringify({ t: token }),
  });
  const rows = JSON.parse(r.getContentText() || "[]");
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function out(text) { return ContentService.createTextOutput(text); }
